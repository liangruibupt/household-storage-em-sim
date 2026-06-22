// MockProvider：IDataProvider 的当前唯一具体实现（多账户，需求 5.2、5.5）
//
// 设计文档（Mock_Provider 设计）要求：
//   - 以 seed-data.ts 生成的确定性**多账户**种子数据作为进程内内存态的初始快照；
//   - 支持账户（≤5）模型：除账户管理本身外，设备/充放电/交易三大功能区的数据
//     均按 accountId 归属于某一具体账户，读写一律以 accountId 作用域过滤（需求 6.5 / Property 21）；
//   - 所有方法永不抛出业务异常，统一返回 Result<T>，意外错误包装为 PROVIDER_ERROR；
//   - connectionStatus 与 7 天数据在读取时由领域函数即时派生，保持与「当前时间」一致；
//   - 账户与业务写操作在校验通过后方修改内存态，校验失败时不改动内存
//     （满足 Property 5、Property 10）；
//   - createAccount 达 5 个返回 ACCOUNT_LIMIT 且不写入（Property 17）；
//     deleteAccount 仅剩 1 个返回 LAST_ACCOUNT 且不删除（Property 18），
//     否则级联移除该账户名下 Device / 记录 / 策略 / 触发历史并返回剩余账户标识（Property 20）；
//   - 内置轻量触发引擎：对每条启用策略调用 evaluateTrigger，按去抖语义记录动作，
//     历史按账户维护、按时间倒序且截断为最近 50 条（满足 Property 13、Property 14）。
//
// 对应需求：1.1、1.2、1.3、1.8、2.4、2.5、2.6、2.11、2.12、2.13、3.1-3.5、3.7、
//          4.1-4.3、4.6、4.7、4.10、4.11、5.2、5.5、5.6、6.4、6.5

import type { IDataProvider } from "../provider";
import type {
  Account,
  AccountProfileInput,
  ChargeDischargeRecord,
  DailySummary,
  DataError,
  Device,
  DeviceDetail,
  MarketState,
  Result,
  StrategyActionRecord,
  TradingStrategy,
  TradingStrategyInput,
  TradingStrategyPatch,
} from "../types";
import {
  validateAccountProfile,
  validateTradingStrategyInput,
} from "../validation";
import { createRng, type Rng } from "./rng";
import {
  CHARGE_DISCHARGE_MAX,
  CHARGE_DISCHARGE_MIN,
  DEFAULT_SEED,
  MAX_ACCOUNTS,
  MAX_DEVICES,
  createSeedData,
  type SeedData,
} from "./seed-data";
import { deriveConnectionStatus } from "../../domain/connection";
import { buildWeeklyRecords } from "../../domain/weekly";
import { evaluateTrigger } from "../../domain/trigger";

// ============================================================
// 常量
// ============================================================

/** 触发历史最大保留条数（需求 4.11 / Property 14） */
const MAX_HISTORY = 50;

/** 模拟电价的取值上界（家庭电价合理量级，单位 货币/kWh） */
const PRICE_MAX = 3;

// ============================================================
// MockProvider 构造选项
// ============================================================

/** MockProvider 构造选项 */
export interface MockProviderOptions {
  /** 固定种子；相同 seed 与 clock 产出完全一致的初始数据（需求 5.2） */
  seed?: number;
  /**
   * 「当前时间」时钟函数（返回 epoch 毫秒），默认 Date.now。
   * 种子数据的设备上报时间在构造时以一次 clock() 调用为基准生成；
   * 读取（如 listDevices / getDevice / getTodaySummary）时再次调用 clock() 取当前时间，
   * 以即时派生连接状态与当日窗口。测试可注入固定时钟以保证确定性。
   */
  clock?: () => number;
  /** 账户数量；将被钳制到 [1, MAX_ACCOUNTS]（需求 6.4） */
  accountCount?: number;
  /** 单账户设备数量；将被钳制到 [0, MAX_DEVICES] */
  deviceCount?: number;
  /** 充放电记录覆盖天数（含当日） */
  recordDays?: number;
  /** 单账户初始策略数量 */
  strategyCount?: number;
}

// ============================================================
// 账户作用域内存态
// ============================================================

/**
 * 单个账户的内存态：账户名下归属的全部业务数据。
 * 以账户为单位组织，便于按 accountId 隔离读写与级联删除（需求 6.5、2.11）。
 */
interface AccountState {
  /** 设备列表（≤ 200，需求 1.1） */
  devices: Device[];
  /** 按设备 id 索引的充放电原始记录（逐自然日，已钳制到合法值域） */
  recordsByDevice: Record<string, ChargeDischargeRecord[]>;
  /** 交易策略列表 */
  strategies: TradingStrategy[];
  /** 触发动作历史（内部以「最新在前」维护，需求 4.11 / Property 14） */
  history: StrategyActionRecord[];
  /** 当前电价（需求 4.11） */
  currentPrice: number;
}

// ============================================================
// 内部工具函数
// ============================================================

/** 构造成功结果 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 构造失败结果 */
function fail<T>(type: DataError["type"], message: string, field?: string): Result<T> {
  const error: DataError = { type, message };
  if (field !== undefined) {
    error.field = field;
  }
  return { ok: false, error };
}

/** 四舍五入保留 2 位小数 */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 将充放电聚合值钳制到合法值域 [0, 999999999.99] 并保留 2 位小数（需求 3.7 / Property 8） */
function clampKwh(value: number): number {
  const rounded = roundTo2(value);
  return Math.min(Math.max(rounded, CHARGE_DISCHARGE_MIN), CHARGE_DISCHARGE_MAX);
}

/**
 * 将 Date 按「本地自然日」格式化为 YYYY-MM-DD。
 * 与 seed-data.ts / weekly.ts 采用相同的本地日历分量基准，避免时区错位。
 */
function formatLocalDay(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 将 ISO8601 时间字符串截断到「秒」精度（需求 1.8：最近一次状态更新时间精确到秒）。
 * 例如 "2024-01-01T08:30:15.123Z" -> "2024-01-01T08:30:15Z"。
 */
function toSecondsPrecision(iso: string): string {
  // 优先剥离毫秒分量；若格式不含毫秒则原样返回
  return iso.replace(/\.\d{3}(?=Z|[+-]\d{2}:?\d{2}$)/, "");
}

// ============================================================
// MockProvider 实现
// ============================================================

/**
 * MockProvider：基于确定性多账户种子数据的内存态数据提供者。
 *
 * 实现 IDataProvider 全部方法签名，作为当前阶段的唯一具体数据来源。
 * 未来接入真实设备 API 时，仅需在 factory.ts 的 getDataProvider() 中替换实现，
 * API_Layer 与 Web_UI 源码零改动（需求 5.3）。
 */
export class MockProvider implements IDataProvider {
  /** 「当前时间」时钟函数（epoch 毫秒） */
  private readonly clock: () => number;

  /** 账户实体集合（1–5 个，按 listAccounts 顺序维护，需求 6.4） */
  private accounts: Account[];

  /** 按 accountId 索引的账户作用域内存态（需求 6.5） */
  private readonly stateByAccount: Map<string, AccountState>;

  /** 用于模拟电价演化的独立 PRNG（与种子数据生成相隔离，保证确定性） */
  private readonly priceRng: Rng;

  /** 账户 id 自增序列，保证创建的账户 id 唯一（即便经历删除） */
  private accountSeq: number;

  /** 策略 id 自增序列（全局），保证创建的策略 id 唯一（即便经历删除） */
  private strategySeq: number;

  /**
   * 构造一个 MockProvider 实例。
   *
   * @param options 构造选项（seed、clock、accountCount、各类数量等）
   */
  constructor(options: MockProviderOptions = {}) {
    const {
      seed = DEFAULT_SEED,
      clock = Date.now,
      accountCount,
      deviceCount,
      recordDays,
      strategyCount,
    } = options;

    this.clock = clock;

    // 以一次 clock() 调用作为种子数据的「当前时间」基准，
    // 保证设备上报时间相对该基准生成（覆盖在线/离线 60s 窗口两侧）。
    const baseNow = clock();
    const seedData: SeedData = createSeedData({
      seed,
      now: baseNow,
      accountCount,
      deviceCount,
      recordDays,
      strategyCount,
    });

    // 电价 PRNG 以与种子数据不同的种子初始化，避免序列耦合
    this.priceRng = createRng((seed ^ 0x9e3779b9) >>> 0);

    this.accounts = [];
    this.stateByAccount = new Map<string, AccountState>();

    // 全局策略序号：从已种子化的策略总数开始，下一次创建从总数 + 1 起
    let totalStrategies = 0;

    // 将种子数据装载为账户作用域内存态
    for (const seeded of seedData.accounts) {
      this.accounts.push({
        id: seeded.account.id,
        profile: { ...seeded.account.profile },
      });
      this.stateByAccount.set(seeded.account.id, {
        devices: seeded.devices,
        recordsByDevice: seeded.recordsByDevice,
        strategies: seeded.strategies,
        history: [],
        // 每个账户初始电价独立抽取，落在 [0, PRICE_MAX]，保留 2 位小数
        currentPrice: roundTo2(this.priceRng.floatInRange(0, PRICE_MAX)),
      });
      totalStrategies += seeded.strategies.length;
    }

    // 账户自增序列从已种子化账户数量开始（账户 id 形如 account-001..account-00N）
    this.accountSeq = this.accounts.length;
    this.strategySeq = totalStrategies;
  }

  // ============================================================
  // 账户方法（需求 2.4、2.5、2.6、2.11、2.12、2.13、6.4）
  // ============================================================

  /** 返回全部账户（≤ 5），用于账户列表与切换器（需求 2.1、6.4） */
  async listAccounts(): Promise<Result<Account[]>> {
    try {
      return ok(this.accounts.map((a) => this.cloneAccount(a)));
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取账户列表失败：${(e as Error).message}`);
    }
  }

  /** 返回单个账户（含资料）；不存在则 NOT_FOUND */
  async getAccount(accountId: string): Promise<Result<Account>> {
    try {
      const account = this.accounts.find((a) => a.id === accountId);
      if (!account) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }
      return ok(this.cloneAccount(account));
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取账户失败：${(e as Error).message}`);
    }
  }

  /**
   * 创建新账户：校验通过且现有账户数 < 5 时持久化并返回新账户；
   * 字段非法返回 VALIDATION，已达 5 个返回 ACCOUNT_LIMIT（均不持久化，需求 2.4、2.5、6.4）。
   */
  async createAccount(input: AccountProfileInput): Promise<Result<Account>> {
    try {
      // 先做字段校验：失败返回 VALIDATION 且不写入（需求 2.7-2.9 / Property 5）
      const validated = validateAccountProfile(input);
      if (!validated.ok) {
        return validated;
      }

      // 校验通过后再检查数量上限：已达 5 个返回 ACCOUNT_LIMIT 且不写入（需求 2.5 / Property 17）
      if (this.accounts.length >= MAX_ACCOUNTS) {
        return fail("ACCOUNT_LIMIT", `账户数量已达上限 ${MAX_ACCOUNTS} 个`);
      }

      // 分配唯一 id 并写入；为新账户初始化空的作用域内存态
      this.accountSeq += 1;
      const id = `account-${String(this.accountSeq).padStart(3, "0")}`;
      const account: Account = { id, profile: { ...validated.data } };
      this.accounts.push(account);
      this.stateByAccount.set(id, {
        devices: [],
        recordsByDevice: {},
        strategies: [],
        history: [],
        currentPrice: roundTo2(this.priceRng.floatInRange(0, PRICE_MAX)),
      });
      return ok(this.cloneAccount(account));
    } catch (e) {
      return fail("PROVIDER_ERROR", `创建账户失败：${(e as Error).message}`);
    }
  }

  /**
   * 更新指定账户资料：校验通过则仅更新该账户并返回最新值；
   * 校验失败返回 VALIDATION 且不改动原值；账户不存在返回 NOT_FOUND；不影响其他账户（需求 2.6 / Property 4）。
   */
  async updateAccountProfile(
    accountId: string,
    input: AccountProfileInput
  ): Promise<Result<Account>> {
    try {
      const index = this.accounts.findIndex((a) => a.id === accountId);
      if (index === -1) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      const validated = validateAccountProfile(input);
      if (!validated.ok) {
        // 校验失败：不修改任何内存态，保持原值不变（需求 2.7-2.9 / Property 5）
        return validated;
      }

      // 校验通过：仅更新目标账户资料，不触及其他账户（Property 4）
      const updated: Account = {
        id: this.accounts[index].id,
        profile: { ...validated.data },
      };
      this.accounts[index] = updated;
      return ok(this.cloneAccount(updated));
    } catch (e) {
      return fail("PROVIDER_ERROR", `更新账户资料失败：${(e as Error).message}`);
    }
  }

  /**
   * 删除指定账户并级联移除其名下 Device / 记录 / 策略 / 触发历史；
   * 账户不存在返回 NOT_FOUND；仅剩 1 个账户返回 LAST_ACCOUNT 且不删除（需求 2.12 / Property 18）；
   * 否则删除并返回剩余账户标识（支持删除 Current_Account 后前端自动切换，需求 2.11、2.13 / Property 20）。
   */
  async deleteAccount(
    accountId: string
  ): Promise<Result<{ id: string; remainingAccountIds: string[] }>> {
    try {
      const index = this.accounts.findIndex((a) => a.id === accountId);
      if (index === -1) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      // 至少需保留 1 个账户：仅剩 1 个时拒绝删除且不改动内存（需求 2.12 / Property 18）
      if (this.accounts.length <= 1) {
        return fail("LAST_ACCOUNT", "至少需保留 1 个账户");
      }

      // 移除账户并级联清理其作用域内存态（设备/记录/策略/历史/电价，需求 2.11 / Property 20）
      this.accounts.splice(index, 1);
      this.stateByAccount.delete(accountId);

      const remainingAccountIds = this.accounts.map((a) => a.id);
      return ok({ id: accountId, remainingAccountIds });
    } catch (e) {
      return fail("PROVIDER_ERROR", `删除账户失败：${(e as Error).message}`);
    }
  }

  // ============================================================
  // 设备方法（账户作用域，需求 1.1、1.2、1.3、1.8、6.5）
  // ============================================================

  /**
   * 返回指定账户名下最多 200 台设备；connectionStatus 在读取时按 60 秒窗口即时派生（需求 1.1、1.2、1.3）。
   * 账户不存在返回 NOT_FOUND（需求 6.5）。
   */
  async listDevices(accountId: string): Promise<Result<Device[]>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }
      const now = this.clock();
      // 防御性截断到 200 台，确保设备数量上限不变量（需求 1.1 / Property 1）
      const list = state.devices.slice(0, MAX_DEVICES).map((device) => ({
        id: device.id,
        accountId: device.accountId,
        name: device.name,
        // 读取时即时派生连接状态，保证与「当前时间」一致（需求 1.3）
        connectionStatus: deriveConnectionStatus(device.lastReportedAt, now),
        lastReportedAt: device.lastReportedAt,
      }));
      return ok(list);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取设备列表失败：${(e as Error).message}`);
    }
  }

  /**
   * 返回指定账户名下单台设备详情；账户或设备不存在则返回 NOT_FOUND（需求 1.8、6.5）。
   * lastStatusUpdatedAt 精确到秒。
   */
  async getDevice(
    accountId: string,
    deviceId: string
  ): Promise<Result<DeviceDetail>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }
      const device = state.devices.find((d) => d.id === deviceId);
      if (!device) {
        return fail("NOT_FOUND", `设备不存在：${deviceId}`);
      }
      const now = this.clock();
      const detail: DeviceDetail = {
        id: device.id,
        accountId: device.accountId,
        name: device.name,
        connectionStatus: deriveConnectionStatus(device.lastReportedAt, now),
        lastReportedAt: device.lastReportedAt,
        // 最近一次状态更新时间精确到秒（需求 1.8）
        lastStatusUpdatedAt: toSecondsPrecision(device.lastReportedAt),
      };
      return ok(detail);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取设备详情失败：${(e as Error).message}`);
    }
  }

  // ============================================================
  // 充放电方法（账户作用域，需求 3.1-3.5、3.7、6.5）
  // ============================================================

  /**
   * 指定账户当日（00:00:00 至当前）总充/放电；deviceId 省略表示该账户全部设备汇总（需求 3.1、3.4）。
   * 数值保留 2 位小数。账户不存在或指定的 deviceId 不存在时返回 NOT_FOUND。
   */
  async getTodaySummary(
    accountId: string,
    deviceId?: string
  ): Promise<Result<DailySummary>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      const now = this.clock();
      const today = formatLocalDay(new Date(now));

      // 选取参与汇总的记录集合（限定在该账户作用域内）
      const recordSets = this.selectRecordSets(state, deviceId);
      if (recordSets === null) {
        return fail("NOT_FOUND", `设备不存在：${deviceId}`);
      }

      let totalCharge = 0;
      let totalDischarge = 0;
      for (const records of recordSets) {
        for (const r of records) {
          if (r.date === today) {
            totalCharge += r.chargeKwh;
            totalDischarge += r.dischargeKwh;
          }
        }
      }

      const summary: DailySummary = {
        date: today,
        // 钳制并保留 2 位小数，满足值域不变量（需求 3.7）
        totalChargeKwh: clampKwh(totalCharge),
        totalDischargeKwh: clampKwh(totalDischarge),
      };
      return ok(summary);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取当日总量失败：${(e as Error).message}`);
    }
  }

  /**
   * 指定账户：返回恰好 7 条、按日期升序、含当日在内向前回溯 7 个连续自然日、缺失日零填充的记录
   * （需求 3.2、3.3、3.5）。deviceId 省略表示跨该账户全部设备按日聚合。
   * 账户不存在或指定的 deviceId 不存在时返回 NOT_FOUND。
   * 返回的每条记录其 accountId 恒等于查询账户（保证账户数据隔离，Property 21）。
   */
  async getWeeklyRecords(
    accountId: string,
    deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      const recordSets = this.selectRecordSets(state, deviceId);
      if (recordSets === null) {
        return fail("NOT_FOUND", `设备不存在：${deviceId}`);
      }

      // 跨所选设备按自然日聚合原始记录（汇总场景按日求和）
      const aggregatedByDate = new Map<string, { charge: number; discharge: number }>();
      for (const records of recordSets) {
        for (const r of records) {
          const acc = aggregatedByDate.get(r.date) ?? { charge: 0, discharge: 0 };
          acc.charge += r.chargeKwh;
          acc.discharge += r.dischargeKwh;
          aggregatedByDate.set(r.date, acc);
        }
      }

      // 汇总场景以空字符串作为 deviceId 哨兵（表示「全部设备」），单设备场景沿用该设备 id
      const scopeDeviceId = deviceId ?? "";

      const aggregatedRaw: ChargeDischargeRecord[] = Array.from(
        aggregatedByDate.entries()
      ).map(([date, sums]) => ({
        accountId,
        deviceId: scopeDeviceId,
        date,
        chargeKwh: clampKwh(sums.charge),
        dischargeKwh: clampKwh(sums.discharge),
      }));

      // 即时派生 7 天零填充集合（需求 3.2、3.3、3.5）
      const today = new Date(this.clock());
      const weekly = buildWeeklyRecords(aggregatedRaw, today);

      // 统一改写归属：保证所有 7 条记录（含零填充日）的 accountId 恒为查询账户，
      // 从而满足账户数据隔离不变量（Property 21、需求 6.5）。
      const scoped = weekly.map((r) => ({
        accountId,
        deviceId: scopeDeviceId,
        date: r.date,
        chargeKwh: r.chargeKwh,
        dischargeKwh: r.dischargeKwh,
      }));
      return ok(scoped);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取 7 天数据失败：${(e as Error).message}`);
    }
  }

  /**
   * 在给定账户作用域内选取参与充放电聚合的记录集合。
   * - deviceId 省略：返回该账户全部设备的记录集合（用于汇总）。
   * - deviceId 指定且属于该账户：返回仅含该设备记录的单元素集合。
   * - deviceId 指定但不属于该账户：返回 null（由调用方转换为 NOT_FOUND）。
   *
   * @param state 账户作用域内存态
   * @param deviceId 可选设备标识
   * @returns 记录集合数组；设备不存在时返回 null
   */
  private selectRecordSets(
    state: AccountState,
    deviceId?: string
  ): ChargeDischargeRecord[][] | null {
    if (deviceId === undefined) {
      return Object.values(state.recordsByDevice);
    }
    const records = state.recordsByDevice[deviceId];
    // 设备本身存在但无记录时，视为存在并返回空记录集合
    const deviceExists =
      records !== undefined || state.devices.some((d) => d.id === deviceId);
    if (!deviceExists) {
      return null;
    }
    return [records ?? []];
  }

  // ============================================================
  // 电力交易方法与触发引擎（账户作用域，需求 4.1-4.3、4.6、4.7、4.10、4.11、6.5）
  // ============================================================

  /** 返回指定账户名下全部交易策略列表（需求 4.1、4.2）；账户不存在返回 NOT_FOUND */
  async listStrategies(accountId: string): Promise<Result<TradingStrategy[]>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }
      // 返回深拷贝，避免外部修改内部状态
      return ok(state.strategies.map((s) => this.cloneStrategy(s)));
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取策略列表失败：${(e as Error).message}`);
    }
  }

  /**
   * 在指定账户下创建策略：校验通过则创建并返回（归属该账户）；
   * 账户不存在返回 NOT_FOUND；校验失败返回 VALIDATION 且不新增任何记录（需求 4.3、4.8、4.9 / Property 10）。
   */
  async createStrategy(
    accountId: string,
    input: TradingStrategyInput
  ): Promise<Result<TradingStrategy>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      const validated = validateTradingStrategyInput(input);
      if (!validated.ok) {
        // 校验失败：不持久化任何数据（需求 4.8、4.9 / Property 10）
        return { ok: false, error: validated.error };
      }

      // 生成全局唯一 id（自增序列，避免与已有/已删除 id 冲突）
      this.strategySeq += 1;
      const id = `strategy-${String(this.strategySeq).padStart(3, "0")}`;

      const strategy: TradingStrategy = {
        id,
        // 归属当前账户（需求 4.3、6.4 / Property 9）
        accountId,
        name: validated.data.name,
        action: validated.data.action,
        condition: {
          comparator: validated.data.condition.comparator,
          priceThreshold: validated.data.condition.priceThreshold,
        },
        enabled: validated.data.enabled,
        // 去抖状态初始未触发（需求 4.10）
        triggered: false,
      };
      state.strategies.push(strategy);
      return ok(this.cloneStrategy(strategy));
    } catch (e) {
      return fail("PROVIDER_ERROR", `创建策略失败：${(e as Error).message}`);
    }
  }

  /**
   * 部分更新指定账户名下策略；账户或策略不存在返回 NOT_FOUND，
   * 校验失败返回 VALIDATION 且不改动内存（需求 4.6）。
   */
  async updateStrategy(
    accountId: string,
    id: string,
    patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      const index = state.strategies.findIndex((s) => s.id === id);
      if (index === -1) {
        return fail("NOT_FOUND", `策略不存在：${id}`);
      }

      const existing = state.strategies[index];

      // 计算合并后的字段值（patch 未提供的字段沿用原值）
      const nextName = patch.name !== undefined ? patch.name : existing.name;
      const nextAction = patch.action !== undefined ? patch.action : existing.action;
      const nextCondition =
        patch.condition !== undefined ? patch.condition : existing.condition;
      const nextEnabled =
        patch.enabled !== undefined ? patch.enabled : existing.enabled;

      // 当 patch 涉及名称、动作或触发条件时，对合并结果做完整校验，
      // 校验失败则不改动内存（保持原值不变）。
      const touchesValidatedFields =
        patch.name !== undefined ||
        patch.action !== undefined ||
        patch.condition !== undefined;
      if (touchesValidatedFields) {
        const validated = validateTradingStrategyInput({
          name: nextName,
          action: nextAction,
          condition: nextCondition,
          enabled: nextEnabled,
        });
        if (!validated.ok) {
          return { ok: false, error: validated.error };
        }
      }

      // 触发条件变更时重置去抖状态，允许在新条件下重新触发（需求 4.10）
      const nextTriggered =
        patch.condition !== undefined ? false : existing.triggered;

      const updated: TradingStrategy = {
        id: existing.id,
        accountId: existing.accountId,
        name: nextName,
        action: nextAction,
        condition: {
          comparator: nextCondition.comparator,
          priceThreshold: nextCondition.priceThreshold,
        },
        enabled: nextEnabled,
        triggered: nextTriggered,
      };
      state.strategies[index] = updated;
      return ok(this.cloneStrategy(updated));
    } catch (e) {
      return fail("PROVIDER_ERROR", `更新策略失败：${(e as Error).message}`);
    }
  }

  /** 删除指定账户名下策略并返回其 id；账户或策略不存在返回 NOT_FOUND（需求 4.7） */
  async deleteStrategy(
    accountId: string,
    id: string
  ): Promise<Result<{ id: string }>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }
      const index = state.strategies.findIndex((s) => s.id === id);
      if (index === -1) {
        return fail("NOT_FOUND", `策略不存在：${id}`);
      }
      state.strategies.splice(index, 1);
      return ok({ id });
    } catch (e) {
      return fail("PROVIDER_ERROR", `删除策略失败：${(e as Error).message}`);
    }
  }

  /**
   * 返回指定账户当前电价与触发动作历史（倒序，最多 50 条，需求 4.11）。
   * 每次调用先演化该账户电价，再运行触发引擎评估该账户全部启用策略。
   * 账户不存在返回 NOT_FOUND。
   */
  async getMarketState(accountId: string): Promise<Result<MarketState>> {
    try {
      const state = this.stateByAccount.get(accountId);
      if (!state) {
        return fail("NOT_FOUND", `账户不存在：${accountId}`);
      }

      // 演化电价：模拟市场电价随时间波动，使触发条件可被反复进入/退出
      state.currentPrice = roundTo2(this.priceRng.floatInRange(0, PRICE_MAX));

      // 运行触发引擎，按去抖语义记录动作（限定在该账户作用域）
      this.runTriggerEngine(state, state.currentPrice);

      const marketState: MarketState = {
        currentPrice: state.currentPrice,
        // 返回历史副本（已为最新在前、且截断至 50 条）
        history: state.history.slice(0, MAX_HISTORY).map((r) => ({ ...r })),
      };
      return ok(marketState);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取市场状态失败：${(e as Error).message}`);
    }
  }

  /**
   * 触发引擎：对指定账户的每条启用策略调用 evaluateTrigger，按去抖语义记录动作。
   *
   * 去抖语义（需求 4.10 / Property 13）：条件满足且此前未触发 -> 记录一次并置 triggered=true；
   * 条件持续满足 -> 不重复记录；条件不再满足 -> 重置 triggered=false。
   * 新动作以「最新在前」写入该账户历史并截断至最近 50 条（需求 4.11 / Property 14）。
   *
   * @param state 账户作用域内存态
   * @param price 当前电价
   */
  private runTriggerEngine(state: AccountState, price: number): void {
    const triggeredAt = new Date(this.clock()).toISOString();

    for (const strategy of state.strategies) {
      // 停用的策略不参与评估，但其去抖状态保持不变
      if (!strategy.enabled) {
        continue;
      }

      const { shouldRecord, nextTriggered } = evaluateTrigger(
        strategy.triggered,
        strategy.condition,
        price
      );
      strategy.triggered = nextTriggered;

      if (shouldRecord) {
        const record: StrategyActionRecord = {
          strategyId: strategy.id,
          strategyName: strategy.name,
          action: strategy.action,
          price,
          triggeredAt,
        };
        // 最新动作置于队首，保证倒序（需求 4.11）
        state.history.unshift(record);
      }
    }

    // 截断历史至最近 50 条（需求 4.11 / Property 14）
    if (state.history.length > MAX_HISTORY) {
      state.history.length = MAX_HISTORY;
    }
  }

  /** 深拷贝账户对象，避免外部持有内部引用 */
  private cloneAccount(a: Account): Account {
    return {
      id: a.id,
      profile: {
        name: a.profile.name,
        email: a.profile.email,
        phone: a.profile.phone,
        address: a.profile.address,
      },
    };
  }

  /** 深拷贝策略对象，避免外部持有内部引用 */
  private cloneStrategy(s: TradingStrategy): TradingStrategy {
    return {
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      action: s.action,
      condition: {
        comparator: s.condition.comparator,
        priceThreshold: s.condition.priceThreshold,
      },
      enabled: s.enabled,
      triggered: s.triggered,
    };
  }
}
