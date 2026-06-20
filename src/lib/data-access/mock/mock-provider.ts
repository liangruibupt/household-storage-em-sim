// MockProvider：IDataProvider 的当前唯一具体实现（需求 5.2、5.5）
//
// 设计文档（Mock_Provider 设计）要求：
//   - 以 seed-data.ts 生成的确定性种子数据作为进程内内存态的初始快照；
//   - 所有方法永不抛出业务异常，统一返回 Result<T>，意外错误包装为 PROVIDER_ERROR；
//   - connectionStatus 与 7 天数据在读取时由领域函数即时派生，保持与「当前时间」一致；
//   - updateAccountProfile / createStrategy / updateStrategy / deleteStrategy 在校验通过后
//     方修改内存态，校验失败时不改动内存（满足 Property 5、Property 10）；
//   - 内置轻量触发引擎：对每条启用策略调用 evaluateTrigger，按去抖语义记录动作，
//     历史按时间倒序且截断为最近 50 条（满足 Property 13、Property 14）。
//
// 对应需求：1.1、1.2、1.3、1.8、2.1-2.5、3.1-3.5、3.7、4.1-4.3、4.6、4.7、4.10、4.11、5.2、5.5、5.6

import type { IDataProvider } from "../provider";
import type {
  AccountProfile,
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
  /** 设备数量；将被钳制到 [0, MAX_DEVICES] */
  deviceCount?: number;
  /** 充放电记录覆盖天数（含当日） */
  recordDays?: number;
  /** 初始策略数量 */
  strategyCount?: number;
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
 * MockProvider：基于确定性种子数据的内存态数据提供者。
 *
 * 实现 IDataProvider 全部方法签名，作为当前阶段的唯一具体数据来源。
 * 未来接入真实设备 API 时，仅需在 factory.ts 的 getDataProvider() 中替换实现，
 * API_Layer 与 Web_UI 源码零改动（需求 5.3）。
 */
export class MockProvider implements IDataProvider {
  /** 「当前时间」时钟函数（epoch 毫秒） */
  private readonly clock: () => number;

  /** 单一用户账户资料（需求 6.4：注册上限 1） */
  private account: AccountProfile;

  /** 设备列表（≤ 200，需求 1.1） */
  private devices: Device[];

  /** 按设备 id 索引的充放电原始记录（逐自然日，已钳制到合法值域） */
  private recordsByDevice: Record<string, ChargeDischargeRecord[]>;

  /** 交易策略列表 */
  private strategies: TradingStrategy[];

  /** 触发动作历史（内部以「最新在前」维护，需求 4.11 / Property 14） */
  private history: StrategyActionRecord[] = [];

  /** 当前电价（需求 4.11） */
  private currentPrice: number;

  /** 用于模拟电价演化的独立 PRNG（与种子数据生成相隔离，保证确定性） */
  private readonly priceRng: Rng;

  /** 策略 id 自增序列，保证创建的策略 id 唯一（即便经历删除） */
  private strategySeq: number;

  /**
   * 构造一个 MockProvider 实例。
   *
   * @param options 构造选项（seed、clock、数量等）
   */
  constructor(options: MockProviderOptions = {}) {
    const {
      seed = DEFAULT_SEED,
      clock = Date.now,
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
      deviceCount,
      recordDays,
      strategyCount,
    });

    this.account = seedData.account;
    this.devices = seedData.devices;
    this.recordsByDevice = seedData.recordsByDevice;
    this.strategies = seedData.strategies;

    // 策略自增序列从初始策略数量开始，下一次创建从 strategies.length + 1 起
    this.strategySeq = seedData.strategies.length;

    // 电价 PRNG 以与种子数据不同的种子初始化，避免序列耦合
    this.priceRng = createRng((seed ^ 0x9e3779b9) >>> 0);
    // 初始电价落在 [0, PRICE_MAX]，保留 2 位小数
    this.currentPrice = roundTo2(this.priceRng.floatInRange(0, PRICE_MAX));
  }

  // ============================================================
  // 设备方法（任务 10.1，需求 1.1、1.2、1.3、1.8）
  // ============================================================

  /**
   * 返回最多 200 台设备；connectionStatus 在读取时按 60 秒窗口即时派生（需求 1.1、1.2、1.3）。
   */
  async listDevices(): Promise<Result<Device[]>> {
    try {
      const now = this.clock();
      // 防御性截断到 200 台，确保设备数量上限不变量（需求 1.1 / Property 1）
      const list = this.devices.slice(0, MAX_DEVICES).map((device) => ({
        id: device.id,
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
   * 返回单台设备详情；不存在则返回 NOT_FOUND（需求 1.8）。
   * lastStatusUpdatedAt 精确到秒。
   */
  async getDevice(deviceId: string): Promise<Result<DeviceDetail>> {
    try {
      const device = this.devices.find((d) => d.id === deviceId);
      if (!device) {
        return fail("NOT_FOUND", `设备不存在：${deviceId}`);
      }
      const now = this.clock();
      const detail: DeviceDetail = {
        id: device.id,
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
  // 账户方法（任务 10.3，需求 2.1-2.5）
  // ============================================================

  /** 获取当前账户资料（需求 2.1） */
  async getAccountProfile(): Promise<Result<AccountProfile>> {
    try {
      // 返回内存态副本，避免外部直接持有内部引用
      return ok({ ...this.account });
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取账户资料失败：${(e as Error).message}`);
    }
  }

  /**
   * 校验通过则持久化并返回最新资料；校验失败返回 VALIDATION 错误且不改动内存（需求 2.2-2.5）。
   */
  async updateAccountProfile(
    input: AccountProfileInput
  ): Promise<Result<AccountProfile>> {
    try {
      const validated = validateAccountProfile(input);
      if (!validated.ok) {
        // 校验失败：不修改任何内存态，直接返回 VALIDATION 错误（需求 2.3-2.5）
        return validated;
      }
      // 校验通过：写入内存态并返回最新值
      this.account = { ...validated.data };
      return ok({ ...this.account });
    } catch (e) {
      return fail("PROVIDER_ERROR", `更新账户资料失败：${(e as Error).message}`);
    }
  }

  // ============================================================
  // 充放电方法（任务 10.5，需求 3.1-3.5、3.7）
  // ============================================================

  /**
   * 当日（00:00:00 至当前）总充/放电；deviceId 省略表示全部设备汇总（需求 3.1、3.4）。
   * 数值保留 2 位小数。指定的 deviceId 不存在时返回 NOT_FOUND。
   */
  async getTodaySummary(deviceId?: string): Promise<Result<DailySummary>> {
    try {
      const now = this.clock();
      const today = formatLocalDay(new Date(now));

      // 选取参与汇总的记录集合
      const recordSets = this.selectRecordSets(deviceId);
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
   * 返回恰好 7 条、按日期升序、含当日在内向前回溯 7 个连续自然日、缺失日零填充的记录（需求 3.2、3.3、3.5）。
   * deviceId 省略表示跨全部设备按日聚合。指定的 deviceId 不存在时返回 NOT_FOUND。
   */
  async getWeeklyRecords(
    deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>> {
    try {
      const recordSets = this.selectRecordSets(deviceId);
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

      const aggregatedRaw: ChargeDischargeRecord[] = Array.from(
        aggregatedByDate.entries()
      ).map(([date, sums]) => ({
        date,
        chargeKwh: clampKwh(sums.charge),
        dischargeKwh: clampKwh(sums.discharge),
      }));

      // 即时派生 7 天零填充集合（需求 3.2、3.3、3.5）
      const today = new Date(this.clock());
      const weekly = buildWeeklyRecords(aggregatedRaw, today);
      return ok(weekly);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取 7 天数据失败：${(e as Error).message}`);
    }
  }

  /**
   * 选取参与充放电聚合的记录集合。
   * - deviceId 省略：返回全部设备的记录集合（用于汇总）。
   * - deviceId 指定且存在：返回仅含该设备记录的单元素集合。
   * - deviceId 指定但不存在：返回 null（由调用方转换为 NOT_FOUND）。
   *
   * @param deviceId 可选设备标识
   * @returns 记录集合数组；设备不存在时返回 null
   */
  private selectRecordSets(
    deviceId?: string
  ): ChargeDischargeRecord[][] | null {
    if (deviceId === undefined) {
      return Object.values(this.recordsByDevice);
    }
    const records = this.recordsByDevice[deviceId];
    // 设备本身存在但无记录时，视为存在并返回空记录集合
    const deviceExists =
      records !== undefined || this.devices.some((d) => d.id === deviceId);
    if (!deviceExists) {
      return null;
    }
    return [records ?? []];
  }

  // ============================================================
  // 电力交易方法与触发引擎（任务 10.8，需求 4.1-4.3、4.6、4.7、4.10、4.11）
  // ============================================================

  /** 返回全部交易策略列表（需求 4.1、4.2） */
  async listStrategies(): Promise<Result<TradingStrategy[]>> {
    try {
      // 返回深拷贝，避免外部修改内部状态
      return ok(this.strategies.map((s) => this.cloneStrategy(s)));
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取策略列表失败：${(e as Error).message}`);
    }
  }

  /**
   * 校验通过则创建策略并返回；校验失败返回 VALIDATION 错误且不新增任何记录（需求 4.3、4.8、4.9）。
   */
  async createStrategy(
    input: TradingStrategyInput
  ): Promise<Result<TradingStrategy>> {
    try {
      const validated = validateTradingStrategyInput(input);
      if (!validated.ok) {
        // 校验失败：不持久化任何数据（需求 4.8、4.9 / Property 10）
        return { ok: false, error: validated.error };
      }

      // 生成唯一 id（自增序列，避免与已有/已删除 id 冲突）
      this.strategySeq += 1;
      const id = `strategy-${String(this.strategySeq).padStart(3, "0")}`;

      const strategy: TradingStrategy = {
        id,
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
      this.strategies.push(strategy);
      return ok(this.cloneStrategy(strategy));
    } catch (e) {
      return fail("PROVIDER_ERROR", `创建策略失败：${(e as Error).message}`);
    }
  }

  /**
   * 部分更新指定策略；不存在返回 NOT_FOUND，校验失败返回 VALIDATION 错误且不改动内存（需求 4.6）。
   */
  async updateStrategy(
    id: string,
    patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>> {
    try {
      const index = this.strategies.findIndex((s) => s.id === id);
      if (index === -1) {
        return fail("NOT_FOUND", `策略不存在：${id}`);
      }

      const existing = this.strategies[index];

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
        name: nextName,
        action: nextAction,
        condition: {
          comparator: nextCondition.comparator,
          priceThreshold: nextCondition.priceThreshold,
        },
        enabled: nextEnabled,
        triggered: nextTriggered,
      };
      this.strategies[index] = updated;
      return ok(this.cloneStrategy(updated));
    } catch (e) {
      return fail("PROVIDER_ERROR", `更新策略失败：${(e as Error).message}`);
    }
  }

  /** 删除指定策略并返回其 id；不存在返回 NOT_FOUND（需求 4.7） */
  async deleteStrategy(id: string): Promise<Result<{ id: string }>> {
    try {
      const index = this.strategies.findIndex((s) => s.id === id);
      if (index === -1) {
        return fail("NOT_FOUND", `策略不存在：${id}`);
      }
      this.strategies.splice(index, 1);
      return ok({ id });
    } catch (e) {
      return fail("PROVIDER_ERROR", `删除策略失败：${(e as Error).message}`);
    }
  }

  /**
   * 返回当前电价与触发动作历史（倒序，最多 50 条，需求 4.11）。
   * 每次调用先演化电价，再运行触发引擎评估全部启用策略。
   */
  async getMarketState(): Promise<Result<MarketState>> {
    try {
      // 演化电价：模拟市场电价随时间波动，使触发条件可被反复进入/退出
      this.currentPrice = roundTo2(this.priceRng.floatInRange(0, PRICE_MAX));

      // 运行触发引擎，按去抖语义记录动作
      this.runTriggerEngine(this.currentPrice);

      const state: MarketState = {
        currentPrice: this.currentPrice,
        // 返回历史副本（已为最新在前、且截断至 50 条）
        history: this.history.slice(0, MAX_HISTORY).map((r) => ({ ...r })),
      };
      return ok(state);
    } catch (e) {
      return fail("PROVIDER_ERROR", `获取市场状态失败：${(e as Error).message}`);
    }
  }

  /**
   * 触发引擎：对每条启用策略调用 evaluateTrigger，按去抖语义记录动作。
   *
   * 去抖语义（需求 4.10 / Property 13）：条件满足且此前未触发 -> 记录一次并置 triggered=true；
   * 条件持续满足 -> 不重复记录；条件不再满足 -> 重置 triggered=false。
   * 新动作以「最新在前」写入历史并截断至最近 50 条（需求 4.11 / Property 14）。
   *
   * @param price 当前电价
   */
  private runTriggerEngine(price: number): void {
    const triggeredAt = new Date(this.clock()).toISOString();

    for (const strategy of this.strategies) {
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
        this.history.unshift(record);
      }
    }

    // 截断历史至最近 50 条（需求 4.11 / Property 14）
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
  }

  /** 深拷贝策略对象，避免外部持有内部引用 */
  private cloneStrategy(s: TradingStrategy): TradingStrategy {
    return {
      id: s.id,
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
