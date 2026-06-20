// 数据访问层抽象接口（DataAccessLayer 核心契约）
// 本文件仅声明 IDataProvider 接口的方法签名，不引用任何具体实现（如 MockProvider）。
// 上层（API_Layer）只依赖此接口的方法签名与返回结构，通过工厂 getDataProvider() 获得当前实现，
// 从而保证数据来源可替换：切换到真实设备 API 时，仅需替换具体实现，接口与上层源码零改动。
// 对应需求：5.1（统一经由抽象接口访问数据）、5.4（接口不泄漏具体来源细节）

import type {
  Result,
  Device,
  DeviceDetail,
  AccountProfile,
  AccountProfileInput,
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
  // 设备（需求 1）
  // ============================================================

  /** 返回最多 200 台设备；connectionStatus 已按 60 秒窗口派生计算 */
  listDevices(): Promise<Result<Device[]>>;

  /** 返回单台设备详情；不存在则返回 NOT_FOUND */
  getDevice(deviceId: string): Promise<Result<DeviceDetail>>;

  // ============================================================
  // 账户（需求 2）
  // ============================================================

  /** 获取当前账户资料 */
  getAccountProfile(): Promise<Result<AccountProfile>>;

  /** 校验通过则持久化并返回更新后资料；失败返回 VALIDATION 错误且不改动原值 */
  updateAccountProfile(
    input: AccountProfileInput
  ): Promise<Result<AccountProfile>>;

  // ============================================================
  // 充放电（需求 3）
  // ============================================================

  /** 当日（00:00:00 至当前）总充/放电；deviceId 省略表示全部设备汇总 */
  getTodaySummary(deviceId?: string): Promise<Result<DailySummary>>;

  /** 恰好 7 条、覆盖含当日在内向前回溯 7 个连续自然日、按日期升序、缺失日零填充 */
  getWeeklyRecords(
    deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>>;

  // ============================================================
  // 电力交易（需求 4）
  // ============================================================

  /** 返回全部交易策略列表 */
  listStrategies(): Promise<Result<TradingStrategy[]>>;

  /** 校验通过则创建策略并返回；失败返回 VALIDATION 错误且不新增任何记录 */
  createStrategy(input: TradingStrategyInput): Promise<Result<TradingStrategy>>;

  /** 部分更新指定策略；不存在返回 NOT_FOUND，校验失败返回 VALIDATION 错误 */
  updateStrategy(
    id: string,
    patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>>;

  /** 删除指定策略并返回其 id；不存在返回 NOT_FOUND */
  deleteStrategy(id: string): Promise<Result<{ id: string }>>;

  /** 当前电价 + 最近触发动作历史（倒序，最多 50 条） */
  getMarketState(): Promise<Result<MarketState>>;
}
