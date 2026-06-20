// 领域类型与统一返回类型定义
// 本文件为数据访问层（DataAccessLayer）的核心契约来源，所有方法均围绕这些类型定义。
// 对应需求：1.2、2.1、3.3、4.4、4.5、5.5

// ============================================================
// 统一返回类型与结构化错误（需求 5.5、5.6）
// ============================================================

/** 结构化错误类型标识（需求 5.6） */
export type DataErrorType =
  | "NOT_FOUND" // 请求的数据不存在
  | "VALIDATION" // 输入校验失败（需求 2.3-2.5、4.8、4.9）
  | "PROVIDER_ERROR" // 数据来源内部错误
  | "TIMEOUT"; // 超时

/** 结构化错误对象：携带可区分失败原因的错误类型标识 */
export interface DataError {
  /** 错误类型标识 */
  type: DataErrorType;
  /** 面向用户的中文提示 */
  message: string;
  /** 校验错误时指明出错字段（如 "email"） */
  field?: string;
}

/** 统一返回类型：成功携带 data，失败携带 error，二者互斥 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: DataError };

// ============================================================
// 设备类型（需求 1）
// ============================================================

/** 连接状态：在线或离线（需求 1.2） */
export type ConnectionStatus = "online" | "offline";

/** 设备：一台家庭储能设备 */
export interface Device {
  /** 唯一标识 */
  id: string;
  /** 设备名称 */
  name: string;
  /** 连接状态，由 60 秒窗口派生计算（需求 1.3） */
  connectionStatus: ConnectionStatus;
  /** 最近上报时间，ISO8601 */
  lastReportedAt: string;
}

/** 设备详情：在设备基础信息上补充精确到秒的状态更新时间（需求 1.8） */
export interface DeviceDetail extends Device {
  /** 最近一次状态更新时间，精确到秒（需求 1.8） */
  lastStatusUpdatedAt: string;
}

// ============================================================
// 账户类型（需求 2）
// ============================================================

/** 账户信息：用户的账户资料 */
export interface AccountProfile {
  /** 姓名，1-50 字符（需求 2.4） */
  name: string;
  /** 邮箱，标准格式且 ≤254 字符（需求 2.3） */
  email: string;
  /** 电话，5-20 字符且仅含 [0-9 + - 空格]（需求 2.5） */
  phone: string;
  /** 地址，≤200 字符（需求 2.5） */
  address: string;
}

/** 账户更新输入：字段结构与 AccountProfile 一致，校验由服务端统一执行 */
export type AccountProfileInput = AccountProfile;

// ============================================================
// 充放电类型（需求 3）
// ============================================================

/** 单条自然日充放电记录；charge/discharge 非负且 ≤ 999,999,999.99（需求 3.7） */
export interface ChargeDischargeRecord {
  /** 自然日，格式 YYYY-MM-DD */
  date: string;
  /** 充电量（kWh），≥ 0 */
  chargeKwh: number;
  /** 放电量（kWh），≥ 0 */
  dischargeKwh: number;
}

/** 当日充放电总量汇总（需求 3.1） */
export interface DailySummary {
  /** 当日日期，格式 YYYY-MM-DD */
  date: string;
  /** 当日总充电量（kWh），展示时保留 2 位小数（需求 3.1） */
  totalChargeKwh: number;
  /** 当日总放电量（kWh），展示时保留 2 位小数（需求 3.1） */
  totalDischargeKwh: number;
}

// ============================================================
// 电力交易类型（需求 4）
// ============================================================

/** 策略动作：充电、放电、买电或卖电（需求 4.4） */
export type StrategyAction = "charge" | "discharge" | "buy" | "sell";

/** 电价比较关系（需求 4.5） */
export type PriceComparator =
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "equal";

/** 触发条件：基于电价阈值与比较关系 */
export interface TriggerCondition {
  /** 比较关系 */
  comparator: PriceComparator;
  /** 电价阈值，0-999999.99（需求 4.9） */
  priceThreshold: number;
}

/** 电力交易策略 */
export interface TradingStrategy {
  /** 唯一标识 */
  id: string;
  /** 策略名称，1-100 字符（需求 4.8） */
  name: string;
  /** 触发后执行的动作 */
  action: StrategyAction;
  /** 触发条件 */
  condition: TriggerCondition;
  /** 启用状态 */
  enabled: boolean;
  /** 去抖状态：当前是否处于"已触发未重置"状态（需求 4.10） */
  triggered: boolean;
}

/** 策略创建输入：排除由系统生成的 id 与去抖状态 triggered */
export type TradingStrategyInput = Omit<TradingStrategy, "id" | "triggered">;

/** 策略更新补丁：可部分更新名称、动作、触发条件与启用状态 */
export type TradingStrategyPatch = Partial<
  Pick<TradingStrategy, "name" | "action" | "condition" | "enabled">
>;

/** 策略动作触发记录 */
export interface StrategyActionRecord {
  /** 触发的策略标识 */
  strategyId: string;
  /** 触发的策略名称 */
  strategyName: string;
  /** 触发的动作 */
  action: StrategyAction;
  /** 触发时的电价 */
  price: number;
  /** 触发时间，ISO8601 */
  triggeredAt: string;
}

/** 市场状态：当前电价与触发历史（需求 4.11） */
export interface MarketState {
  /** 当前电价（需求 4.11） */
  currentPrice: number;
  /** 触发动作历史，按时间倒序，最多 50 条（需求 4.11） */
  history: StrategyActionRecord[];
}
