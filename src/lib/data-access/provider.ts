// 数据访问层抽象接口（DataAccessLayer 核心契约）
// 本文件仅声明 IDataProvider 接口的方法签名，不引用任何具体实现（如 MockProvider）。
// 上层（API_Layer）只依赖此接口的方法签名与返回结构，通过工厂 getDataProvider() 获得当前实现，
// 从而保证数据来源可替换：切换到真实设备 API 时，仅需替换具体实现，接口与上层源码零改动。
// 平台为多账户模型（≤5）：除账户管理本身外，设备/充放电/电力交易三大功能区的数据
// 均限定在某一账户（accountId）作用域内，故相关方法均以 accountId 作为首个参数。
// 对应需求：5.1（统一经由抽象接口访问数据）、5.4（接口不泄漏具体来源细节）、
//          2.4/2.6/2.11/2.12（账户增删改查与级联删除）、6.5（账户作用域数据隔离）

import type {
  Result,
  Account,
  AccountProfileInput,
  Device,
  DeviceDetail,
  DailySummary,
  ChargeDischargeRecord,
  TradingStrategy,
  TradingStrategyInput,
  TradingStrategyPatch,
  MarketState,
} from "./types";

/**
 * 数据提供者抽象接口
 *
 * 所有方法均返回 Promise<Result<T>>：成功携带业务数据，失败携带结构化错误对象，
 * 二者互斥且永不抛出业务异常（详见 types.ts 中的 Result<T> 与 DataError）。
 *
 * 该接口不引用任何具体实现，是 API_Layer 与具体数据来源之间的唯一契约边界。
 */
export interface IDataProvider {
  // ============================================================
  // 账户（需求 2、6.4）
  // ============================================================

  /** 返回全部 Account（最多 5 个），用于账户列表与切换器 */
  listAccounts(): Promise<Result<Account[]>>;

  /** 返回单个 Account（含 AccountProfile）；不存在则返回 NOT_FOUND */
  getAccount(accountId: string): Promise<Result<Account>>;

  /**
   * 创建新 Account：校验通过且现有账户数 < 5 时持久化并返回新 Account；
   * 已达 5 个返回 ACCOUNT_LIMIT；字段非法返回 VALIDATION（均不持久化）
   */
  createAccount(input: AccountProfileInput): Promise<Result<Account>>;

  /** 更新指定 Account 的资料；校验失败返回 VALIDATION 且不改动原值，不影响其他 Account */
  updateAccountProfile(
    accountId: string,
    input: AccountProfileInput
  ): Promise<Result<Account>>;

  /**
   * 删除指定 Account 并级联移除其名下 Device / ChargeDischargeRecord / TradingStrategy；
   * 若为当前唯一账户则返回 LAST_ACCOUNT 且不删除（需求 2.12）
   */
  deleteAccount(
    accountId: string
  ): Promise<Result<{ id: string; remainingAccountIds: string[] }>>;

  // ============================================================
  // 设备（需求 1、账户作用域 6.5）
  // ============================================================

  /** 返回指定账户名下最多 200 台设备；connectionStatus 已按 60 秒窗口派生计算 */
  listDevices(accountId: string): Promise<Result<Device[]>>;

  /** 返回指定账户名下单台设备详情；不存在或不属于该账户则返回 NOT_FOUND */
  getDevice(accountId: string, deviceId: string): Promise<Result<DeviceDetail>>;

  // ============================================================
  // 充放电（需求 3、账户作用域 6.5）
  // ============================================================

  /** 指定账户当日（00:00:00 至当前）总充/放电；deviceId 省略表示该账户全部设备汇总 */
  getTodaySummary(
    accountId: string,
    deviceId?: string
  ): Promise<Result<DailySummary>>;

  /** 指定账户：恰好 7 条、覆盖含当日在内向前回溯 7 个连续自然日、按日期升序、缺失日零填充 */
  getWeeklyRecords(
    accountId: string,
    deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>>;

  // ============================================================
  // 电力交易（需求 4、账户作用域 6.5）
  // ============================================================

  /** 返回指定账户名下全部交易策略列表 */
  listStrategies(accountId: string): Promise<Result<TradingStrategy[]>>;

  /** 在指定账户下创建策略：校验通过则创建并返回（归属该账户）；失败返回 VALIDATION 且不新增任何记录 */
  createStrategy(
    accountId: string,
    input: TradingStrategyInput
  ): Promise<Result<TradingStrategy>>;

  /** 部分更新指定账户名下策略；不存在返回 NOT_FOUND，校验失败返回 VALIDATION 错误 */
  updateStrategy(
    accountId: string,
    id: string,
    patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>>;

  /** 删除指定账户名下策略并返回其 id；不存在返回 NOT_FOUND */
  deleteStrategy(
    accountId: string,
    id: string
  ): Promise<Result<{ id: string }>>;

  /** 指定账户当前电价 + 最近触发动作历史（倒序，最多 50 条） */
  getMarketState(accountId: string): Promise<Result<MarketState>>;
}
