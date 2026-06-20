// Mock 数据基础设施：确定性种子数据（需求 1.1、3.7、5.2、6.4）
//
// 设计文档（Mock_Provider 设计 / 确定性与种子化、内存状态与持久化语义）要求：
//   由固定 seed 驱动的可种子化 PRNG（见 ./rng.ts）生成一组**确定性、可复现**的
//   初始数据，作为 MockProvider 进程内内存态的初始快照。本模块仅负责「生成种子数据」，
//   不实现 MockProvider 本身（属于任务 10.x）。
//
// 生成的数据满足以下不变量：
//   - 设备数量不超过 200（需求 1.1 / Property 1）。
//   - 设备 lastReportedAt 由 seed 决定相对「当前时间」now 的偏移，
//     覆盖在线/离线 60 秒窗口的两侧边界，便于验证连接状态判定（需求 1.2、1.3 / Property 3）。
//   - 充放电数值在**生成阶段**即钳制（clamp）到 [0, 999999999.99]，
//     从源头满足充放电值域不变量（需求 3.7 / Property 8）。
//   - 全部数据归属**单一 User**（注册数量上限 1，需求 6.4）：仅生成一份 AccountProfile，
//     设备、策略、充放电记录均属于该唯一用户。
//   - 充放电原始记录覆盖足够天数，以支撑「当日总量」与「含当日在内向前回溯 7 个自然日」
//     的聚合（需求 3.2、3.3）；7 天零填充由 weekly.ts 的 buildWeeklyRecords 在读取时即时派生。
//
// 确定性说明：给定相同的 seed 与 now，本模块产出的全部数据完全一致，使属性测试可稳定重放。

import type {
  AccountProfile,
  ChargeDischargeRecord,
  Device,
  PriceComparator,
  StrategyAction,
  TradingStrategy,
} from "../types";
import { createRng, type Rng } from "./rng";
import { ONLINE_WINDOW_MS, deriveConnectionStatus } from "../../domain/connection";

// ============================================================
// 常量与边界（与领域类型、设计文档保持一致）
// ============================================================

/** 设备数量上限（需求 1.1 / Property 1）：listDevices 与种子数据均不得超过此值 */
export const MAX_DEVICES = 200;

/** 充放电数值下界（需求 3.7 / Property 8） */
export const CHARGE_DISCHARGE_MIN = 0;

/** 充放电数值上界（需求 3.7 / Property 8） */
export const CHARGE_DISCHARGE_MAX = 999999999.99;

/** 电价阈值上界（需求 4.9）：用于钳制策略触发条件的 priceThreshold */
export const PRICE_THRESHOLD_MAX = 999999.99;

/** 默认固定种子：保证默认情况下种子数据可复现（需求 5.2） */
export const DEFAULT_SEED = 0x5eed; // 24301，任意固定值，仅需稳定

/** 默认生成的设备数量（≤ MAX_DEVICES）；包含覆盖在线/离线两侧的样本 */
export const DEFAULT_DEVICE_COUNT = 24;

/**
 * 充放电原始记录覆盖的自然日天数（含当日）。
 * 取 10 天 > 7 天，为「当日 + 向前回溯 7 个自然日」的聚合留出余量；
 * 7 天零填充窗口由 weekly.ts 在读取时即时计算，本模块只负责提供足量原始记录。
 */
export const DEFAULT_RECORD_DAYS = 10;

/** 默认生成的初始交易策略数量 */
export const DEFAULT_STRATEGY_COUNT = 4;

// ============================================================
// 种子数据结构
// ============================================================

/**
 * 种子数据快照：MockProvider 内存态的初始来源。
 *
 * 充放电记录以「设备 id -> 该设备的逐日记录」的映射形式给出，
 * 以便上层既能按 deviceId 取单台设备数据，也能跨设备汇总（需求 3.1、3.4）。
 */
export interface SeedData {
  /** 唯一用户的账户资料（需求 6.4：注册上限 1，仅一份） */
  account: AccountProfile;
  /** 设备列表（≤ 200，需求 1.1） */
  devices: Device[];
  /** 按设备 id 索引的充放电原始记录（逐自然日，已钳制到合法值域） */
  recordsByDevice: Record<string, ChargeDischargeRecord[]>;
  /** 初始交易策略列表 */
  strategies: TradingStrategy[];
}

/** 种子数据生成选项 */
export interface SeedDataOptions {
  /** 固定种子；相同 seed 与 now 产出完全一致的数据（需求 5.2） */
  seed?: number;
  /** 「当前时间」基准（epoch 毫秒）；设备上报时间与记录日期相对此值计算，默认 Date.now() */
  now?: number;
  /** 设备数量；将被钳制到 [0, MAX_DEVICES] */
  deviceCount?: number;
  /** 充放电记录覆盖天数（含当日） */
  recordDays?: number;
  /** 初始策略数量 */
  strategyCount?: number;
}

// ============================================================
// 内部工具函数（纯函数，便于复现与测试）
// ============================================================

/**
 * 将数值四舍五入保留 2 位小数。
 *
 * 参数:
 *   value (number): 原始数值
 *
 * 返回:
 *   number: 保留 2 位小数后的数值
 */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 将充放电数值钳制到合法值域 [0, 999999999.99] 并保留 2 位小数。
 * 从生成阶段即保证充放电值域不变量（需求 3.7 / Property 8）。
 *
 * 参数:
 *   value (number): 原始充放电数值
 *
 * 返回:
 *   number: 位于 [CHARGE_DISCHARGE_MIN, CHARGE_DISCHARGE_MAX] 的 2 位小数数值
 */
function clampKwh(value: number): number {
  const rounded = roundTo2(value);
  return Math.min(Math.max(rounded, CHARGE_DISCHARGE_MIN), CHARGE_DISCHARGE_MAX);
}

/**
 * 将电价阈值钳制到合法值域 [0, 999999.99] 并保留 2 位小数（需求 4.9）。
 *
 * 参数:
 *   value (number): 原始电价阈值
 *
 * 返回:
 *   number: 位于 [0, PRICE_THRESHOLD_MAX] 的 2 位小数数值
 */
function clampPriceThreshold(value: number): number {
  const rounded = roundTo2(value);
  return Math.min(Math.max(rounded, 0), PRICE_THRESHOLD_MAX);
}

/**
 * 将 Date 按「本地自然日」格式化为 YYYY-MM-DD。
 * 与 weekly.ts 的 formatNaturalDay 采用相同的本地日历分量基准，
 * 避免因时区换算导致种子记录与 7 天窗口整体错位一天。
 *
 * 参数:
 *   date (Date): 待格式化的日期
 *
 * 返回:
 *   string: 形如 "2024-01-09" 的自然日字符串
 */
function formatLocalDay(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 生成形如 "device-001" 的稳定设备 id。
 *
 * 参数:
 *   index (number): 从 0 起的序号
 *
 * 返回:
 *   string: 补零到 3 位的稳定标识
 */
function deviceId(index: number): string {
  return `device-${String(index + 1).padStart(3, "0")}`;
}

// ============================================================
// 各类数据生成器
// ============================================================

/**
 * 生成唯一用户的账户资料（需求 6.4：注册上限 1，仅生成一份）。
 *
 * 字段均落在校验约束内：姓名 1–50、邮箱标准格式且 ≤254、
 * 电话 5–20 且仅含 [0-9 + - 空格]、地址 ≤200。
 *
 * 参数:
 *   rng (Rng): 可种子化随机数生成器
 *
 * 返回:
 *   AccountProfile: 单一用户账户资料
 */
function generateAccount(rng: Rng): AccountProfile {
  // 候选池均为合法值，由 seed 决定具体取值，保证确定性
  const names = ["张伟", "李娜", "王芳", "刘洋", "陈静"];
  const cities = ["beijing", "shanghai", "shenzhen", "hangzhou", "chengdu"];

  const name = names[rng.intInRange(0, names.length - 1)];
  const city = cities[rng.intInRange(0, cities.length - 1)];
  // 邮箱本地部分附带一个由 seed 决定的编号，整体为标准格式且远小于 254 字符
  const email = `${city}.user${rng.intInRange(100, 999)}@example.com`;
  // 电话仅含合法字符 [0-9 + - 空格]，长度落在 5–20 之间
  const phone = `+86 138-${rng.intInRange(1000, 9999)}-${rng.intInRange(1000, 9999)}`;
  // 地址远小于 200 字符
  const address = `${city} city, district ${rng.intInRange(1, 12)}, road ${rng.intInRange(1, 200)}`;

  return { name, email, phone, address };
}

/**
 * 生成设备列表，确保数量 ≤ 200，并覆盖在线/离线 60 秒窗口两侧边界。
 *
 * lastReportedAt 由「now 减去 seed 决定的偏移」得到：
 *   - 偏移 ≤ 60000ms -> 在线；偏移 > 60000ms -> 离线（需求 1.3 / Property 3）。
 *   - 当数量 ≥ 1 时，强制首台设备在线；当数量 ≥ 2 时，强制第二台设备离线；
 *     其余设备偏移在两侧随机分布，确保样本同时包含在线与离线设备。
 * connectionStatus 由领域函数 deriveConnectionStatus 派生，保持与判定逻辑一致。
 *
 * 参数:
 *   rng (Rng): 可种子化随机数生成器
 *   now (number): 「当前时间」基准（epoch 毫秒）
 *   count (number): 期望设备数量（将被钳制到 [0, MAX_DEVICES]）
 *
 * 返回:
 *   Device[]: 设备列表
 */
function generateDevices(rng: Rng, now: number, count: number): Device[] {
  // 钳制设备数量到 [0, 200]，从源头满足设备数量上限不变量（需求 1.1 / Property 1）
  const total = Math.min(Math.max(Math.trunc(count), 0), MAX_DEVICES);

  const devices: Device[] = [];
  for (let i = 0; i < total; i++) {
    let offsetMs: number;

    if (i === 0) {
      // 首台：偏移落在 [0, 60000]，必为在线
      offsetMs = rng.intInRange(0, ONLINE_WINDOW_MS);
    } else if (i === 1) {
      // 第二台：偏移落在 (60000, 60000 + 9 分钟]，必为离线
      offsetMs = ONLINE_WINDOW_MS + 1 + rng.intInRange(0, 9 * 60_000);
    } else {
      // 其余：偏移落在 [0, 10 分钟]，在线/离线混合分布
      offsetMs = rng.intInRange(0, 10 * 60_000);
    }

    const lastReportedAt = new Date(now - offsetMs).toISOString();

    devices.push({
      id: deviceId(i),
      name: `储能设备 ${String(i + 1).padStart(3, "0")}`,
      // 连接状态由 60 秒窗口即时派生，保持取值封闭于 {online, offline}（需求 1.2、1.3）
      connectionStatus: deriveConnectionStatus(lastReportedAt, now),
      lastReportedAt,
    });
  }

  return devices;
}

/**
 * 为单台设备生成覆盖最近若干自然日（含当日）的充放电原始记录。
 * 每条记录的 chargeKwh / dischargeKwh 在生成阶段即钳制到 [0, 999999999.99]（需求 3.7 / Property 8）。
 *
 * 参数:
 *   rng (Rng): 可种子化随机数生成器
 *   now (number): 「当前时间」基准（epoch 毫秒）
 *   days (number): 覆盖天数（含当日），将被钳制到 ≥ 1
 *
 * 返回:
 *   ChargeDischargeRecord[]: 按日期升序排列的逐日记录
 */
function generateDeviceRecords(
  rng: Rng,
  now: number,
  days: number
): ChargeDischargeRecord[] {
  // 至少覆盖 1 天，保证「当日总量」可计算
  const span = Math.max(Math.trunc(days), 1);

  // 取 now 的本地日历分量作为窗口右端（含当日）
  const base = new Date(now);
  const baseYear = base.getFullYear();
  const baseMonth = base.getMonth();
  const baseDay = base.getDate();

  const records: ChargeDischargeRecord[] = [];
  // 由最久远的一天回溯到当日（offset 由大到小），天然得到按日期升序的记录
  for (let offset = span - 1; offset >= 0; offset--) {
    // new Date(year, month, day - offset) 可自动处理跨月与跨年边界
    const dayDate = new Date(baseYear, baseMonth, baseDay - offset);

    // 充放电量取自实际家庭储能的合理量级（约 0–80 kWh），并统一经 clampKwh 钳制保证值域
    const chargeKwh = clampKwh(rng.floatInRange(0, 80));
    const dischargeKwh = clampKwh(rng.floatInRange(0, 80));

    records.push({
      date: formatLocalDay(dayDate),
      chargeKwh,
      dischargeKwh,
    });
  }

  return records;
}

/**
 * 生成初始交易策略列表。
 * 各字段均落在校验约束内：名称 1–100、action ∈ 4 种枚举、comparator ∈ 5 种枚举、
 * priceThreshold ∈ [0, 999999.99]；triggered 初始为 false（去抖状态未触发，需求 4.10）。
 *
 * 参数:
 *   rng (Rng): 可种子化随机数生成器
 *   count (number): 策略数量（将被钳制到 ≥ 0）
 *
 * 返回:
 *   TradingStrategy[]: 初始策略列表
 */
function generateStrategies(rng: Rng, count: number): TradingStrategy[] {
  const total = Math.max(Math.trunc(count), 0);

  // 4 种动作与 5 种比较关系，与领域类型枚举保持一致
  const actions: StrategyAction[] = ["charge", "discharge", "buy", "sell"];
  const comparators: PriceComparator[] = [
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
    "equal",
  ];
  // 合法且具描述性的策略名称池（长度均在 1–100 之间）
  const names = [
    "谷电低价充电",
    "峰电高价放电",
    "低价买入电力",
    "高价卖出电力",
    "夜间储能策略",
    "白天峰值放电",
  ];

  const strategies: TradingStrategy[] = [];
  for (let i = 0; i < total; i++) {
    const action = actions[rng.intInRange(0, actions.length - 1)];
    const comparator = comparators[rng.intInRange(0, comparators.length - 1)];
    // 电价阈值取家庭电价合理量级（约 0–3 元/kWh），并钳制到合法上界
    const priceThreshold = clampPriceThreshold(rng.floatInRange(0, 3));

    strategies.push({
      id: `strategy-${String(i + 1).padStart(3, "0")}`,
      name: names[i % names.length],
      action,
      condition: { comparator, priceThreshold },
      // 初始约半数启用，由 seed 决定，保证确定性
      enabled: rng.next() < 0.5,
      // 去抖状态初始未触发（需求 4.10）
      triggered: false,
    });
  }

  return strategies;
}

// ============================================================
// 对外入口
// ============================================================

/**
 * 由固定 seed 生成一份确定性的种子数据快照。
 *
 * 相同的 seed 与 now 将产出完全一致的数据（需求 5.2）。生成的数据满足：
 *   - 设备数量 ≤ 200（需求 1.1）；
 *   - 设备 lastReportedAt 覆盖在线/离线 60 秒窗口两侧（需求 1.3）；
 *   - 充放电数值落在 [0, 999999999.99]（需求 3.7）；
 *   - 全部数据归属单一用户（需求 6.4）；
 *   - 充放电记录覆盖足量自然日以支撑当日总量与 7 天聚合（需求 3.2、3.3）。
 *
 * 参数:
 *   options (SeedDataOptions): 可选生成参数（seed、now、数量等）
 *
 * 返回:
 *   SeedData: 种子数据快照
 */
export function createSeedData(options: SeedDataOptions = {}): SeedData {
  const {
    seed = DEFAULT_SEED,
    now = Date.now(),
    deviceCount = DEFAULT_DEVICE_COUNT,
    recordDays = DEFAULT_RECORD_DAYS,
    strategyCount = DEFAULT_STRATEGY_COUNT,
  } = options;

  // 单一 PRNG 实例驱动全部生成过程，保证整份快照在给定 seed 下完全确定
  const rng = createRng(seed);

  // 1) 唯一用户账户（注册上限 1，需求 6.4）
  const account = generateAccount(rng);

  // 2) 设备列表（≤ 200，覆盖在线/离线两侧，需求 1.1、1.3）
  const devices = generateDevices(rng, now, deviceCount);

  // 3) 各设备充放电原始记录（值域已钳制，需求 3.7）
  const recordsByDevice: Record<string, ChargeDischargeRecord[]> = {};
  for (const device of devices) {
    recordsByDevice[device.id] = generateDeviceRecords(rng, now, recordDays);
  }

  // 4) 初始交易策略列表
  const strategies = generateStrategies(rng, strategyCount);

  return { account, devices, recordsByDevice, strategies };
}
