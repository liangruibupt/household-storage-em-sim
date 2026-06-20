// Feature: energy-storage-management, Property 15: 成功返回符合数据契约
//
// 被测对象：src/lib/data-access/mock/mock-provider.ts 的 MockProvider（IDataProvider 当前实现）
// Validates: Requirements 5.2, 5.5
//
// 断言不变量（对所有合法输入成立）：
//   对任意 IDataProvider 方法的成功调用，返回值满足 ok=true，且 data 的字段集合与
//   字段类型均符合该方法在 types.ts 中声明的结构契约——
//     · 必填字段全部存在，且无多余字段（字段集合精确匹配）；
//     · 基本类型正确（string / number / boolean）；
//     · 枚举取值落在允许集合内（ConnectionStatus / StrategyAction / PriceComparator）；
//     · 数组类型字段（Device[] / ChargeDischargeRecord[] / TradingStrategy[] /
//       StrategyActionRecord[]）每个元素均符合各自的契约（数组结构良好）。
//
// 覆盖的全部方法：listDevices、getDevice、getAccountProfile、updateAccountProfile、
//   getTodaySummary、getWeeklyRecords、listStrategies、createStrategy、updateStrategy、
//   deleteStrategy、getMarketState。
//
// 确定性：注入固定时钟（clock 恒返回同一 epoch 毫秒），并以 fast-check 生成的多组
// seed / deviceCount / strategyCount / recordDays 驱动 MockProvider，保证可复现（FC_PARAMS）。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import type { Result } from "@/lib/data-access/types";
import { validAccountProfile } from "@/test/arbitraries/account";
import { validTradingStrategyInput } from "@/test/arbitraries/strategy";

// 固定「当前时间」基准（epoch 毫秒）：注入为 MockProvider 时钟，保证确定性。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

// ============================================================
// 基础类型与结构判定工具（纯函数运行时 shape-checker）
// ============================================================

/** 允许的连接状态集合（需求 1.2） */
const CONNECTION_STATUSES = new Set(["online", "offline"]);

/** 允许的策略动作集合（需求 4.4） */
const STRATEGY_ACTIONS = new Set(["charge", "discharge", "buy", "sell"]);

/** 允许的电价比较关系集合（需求 4.5） */
const PRICE_COMPARATORS = new Set([
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal",
]);

/** 自然日格式 YYYY-MM-DD */
const NATURAL_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 判定为字符串 */
function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** 判定为有限数值（排除 NaN / Infinity） */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 判定为布尔值 */
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/** 判定为非空普通对象（排除 null 与数组） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 判定对象的「自有可枚举键集合」是否与期望键集合精确一致（无缺失、无多余）。
 * 用于保证返回数据的字段集合严格符合契约（需求 5.5）。
 */
function hasExactKeys(obj: unknown, expected: readonly string[]): boolean {
  if (!isPlainObject(obj)) return false;
  const actual = Object.keys(obj).sort();
  const want = [...expected].sort();
  if (actual.length !== want.length) return false;
  return actual.every((k, i) => k === want[i]);
}

// ============================================================
// 各领域类型的 shape-checker（字段集合 + 类型 + 枚举 + 数组）
// ============================================================

/** Device 契约：{ id, name, connectionStatus∈枚举, lastReportedAt } */
function isDevice(v: unknown): boolean {
  if (!hasExactKeys(v, ["id", "name", "connectionStatus", "lastReportedAt"])) {
    return false;
  }
  const d = v as Record<string, unknown>;
  return (
    isString(d.id) &&
    isString(d.name) &&
    isString(d.connectionStatus) &&
    CONNECTION_STATUSES.has(d.connectionStatus as string) &&
    isString(d.lastReportedAt)
  );
}

/** DeviceDetail 契约：Device 全部字段 + lastStatusUpdatedAt（字符串） */
function isDeviceDetail(v: unknown): boolean {
  if (
    !hasExactKeys(v, [
      "id",
      "name",
      "connectionStatus",
      "lastReportedAt",
      "lastStatusUpdatedAt",
    ])
  ) {
    return false;
  }
  const d = v as Record<string, unknown>;
  return (
    isString(d.id) &&
    isString(d.name) &&
    isString(d.connectionStatus) &&
    CONNECTION_STATUSES.has(d.connectionStatus as string) &&
    isString(d.lastReportedAt) &&
    isString(d.lastStatusUpdatedAt)
  );
}

/** AccountProfile 契约：{ name, email, phone, address } 均为字符串 */
function isAccountProfile(v: unknown): boolean {
  if (!hasExactKeys(v, ["name", "email", "phone", "address"])) return false;
  const a = v as Record<string, unknown>;
  return (
    isString(a.name) &&
    isString(a.email) &&
    isString(a.phone) &&
    isString(a.address)
  );
}

/** DailySummary 契约：{ date(YYYY-MM-DD), totalChargeKwh, totalDischargeKwh } */
function isDailySummary(v: unknown): boolean {
  if (!hasExactKeys(v, ["date", "totalChargeKwh", "totalDischargeKwh"])) {
    return false;
  }
  const s = v as Record<string, unknown>;
  return (
    isString(s.date) &&
    NATURAL_DAY_RE.test(s.date as string) &&
    isFiniteNumber(s.totalChargeKwh) &&
    isFiniteNumber(s.totalDischargeKwh)
  );
}

/** ChargeDischargeRecord 契约：{ date(YYYY-MM-DD), chargeKwh, dischargeKwh } */
function isChargeDischargeRecord(v: unknown): boolean {
  if (!hasExactKeys(v, ["date", "chargeKwh", "dischargeKwh"])) return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r.date) &&
    NATURAL_DAY_RE.test(r.date as string) &&
    isFiniteNumber(r.chargeKwh) &&
    isFiniteNumber(r.dischargeKwh)
  );
}

/** TriggerCondition 契约：{ comparator∈枚举, priceThreshold } */
function isTriggerCondition(v: unknown): boolean {
  if (!hasExactKeys(v, ["comparator", "priceThreshold"])) return false;
  const c = v as Record<string, unknown>;
  return (
    isString(c.comparator) &&
    PRICE_COMPARATORS.has(c.comparator as string) &&
    isFiniteNumber(c.priceThreshold)
  );
}

/** TradingStrategy 契约：{ id, name, action∈枚举, condition, enabled, triggered } */
function isTradingStrategy(v: unknown): boolean {
  if (
    !hasExactKeys(v, [
      "id",
      "name",
      "action",
      "condition",
      "enabled",
      "triggered",
    ])
  ) {
    return false;
  }
  const s = v as Record<string, unknown>;
  return (
    isString(s.id) &&
    isString(s.name) &&
    isString(s.action) &&
    STRATEGY_ACTIONS.has(s.action as string) &&
    isTriggerCondition(s.condition) &&
    isBoolean(s.enabled) &&
    isBoolean(s.triggered)
  );
}

/** StrategyActionRecord 契约：{ strategyId, strategyName, action∈枚举, price, triggeredAt } */
function isStrategyActionRecord(v: unknown): boolean {
  if (
    !hasExactKeys(v, [
      "strategyId",
      "strategyName",
      "action",
      "price",
      "triggeredAt",
    ])
  ) {
    return false;
  }
  const r = v as Record<string, unknown>;
  return (
    isString(r.strategyId) &&
    isString(r.strategyName) &&
    isString(r.action) &&
    STRATEGY_ACTIONS.has(r.action as string) &&
    isFiniteNumber(r.price) &&
    isString(r.triggeredAt)
  );
}

/** MarketState 契约：{ currentPrice, history: StrategyActionRecord[] } */
function isMarketState(v: unknown): boolean {
  if (!hasExactKeys(v, ["currentPrice", "history"])) return false;
  const m = v as Record<string, unknown>;
  return (
    isFiniteNumber(m.currentPrice) &&
    Array.isArray(m.history) &&
    m.history.every(isStrategyActionRecord)
  );
}

/** deleteStrategy 返回契约：{ id: string } */
function isDeleteResult(v: unknown): boolean {
  if (!hasExactKeys(v, ["id"])) return false;
  return isString((v as Record<string, unknown>).id);
}

// ============================================================
// 测试工具
// ============================================================

/** 从 Result 中取出成功数据；失败则让测试断言失败 */
function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(
      `期望成功结果，实际失败：${result.error.type} ${result.error.message}`
    );
  }
  return result.data;
}

// —— 生成器：驱动 MockProvider 的确定性种子参数 ——

/** seed：32 位无符号整数范围内的任意值 */
const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

/** deviceCount：≥ 1 保证存在可查询的设备（覆盖单设备与多设备） */
const deviceCountArb = fc.integer({ min: 1, max: 40 });

/** strategyCount：≥ 1 保证存在可更新/删除的策略 */
const strategyCountArb = fc.integer({ min: 1, max: 8 });

/** recordDays：充放电记录覆盖天数（含当日），至少 1 天 */
const recordDaysArb = fc.integer({ min: 1, max: 14 });

describe("Property 15: 成功返回符合数据契约 (全部 IDataProvider 方法)", () => {
  it("Feature: energy-storage-management, Property 15 — 各方法成功返回的 data 字段集合与类型均符合契约", async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        deviceCountArb,
        strategyCountArb,
        recordDaysArb,
        validAccountProfile,
        validTradingStrategyInput,
        fc.boolean(),
        async (
          seed,
          deviceCount,
          strategyCount,
          recordDays,
          accountInput,
          strategyInput,
          enabledPatch
        ) => {
          // 注入固定时钟，保证「当前时间」相关派生在整个用例内一致（确定性）
          const provider = new MockProvider({
            seed,
            clock: () => FIXED_NOW,
            deviceCount,
            strategyCount,
            recordDays,
          });

          // 1) listDevices(): 成功且 data 为 Device[]（数组良构）
          const devices = expectOk(await provider.listDevices());
          expect(Array.isArray(devices)).toBe(true);
          expect(devices.every(isDevice)).toBe(true);
          expect(devices.length).toBeGreaterThanOrEqual(1);

          // 2) getDevice(id): 成功且 data 为 DeviceDetail（取一台存在的设备）
          const someDeviceId = devices[0].id;
          const detail = expectOk(await provider.getDevice(someDeviceId));
          expect(isDeviceDetail(detail)).toBe(true);

          // 3) getAccountProfile(): 成功且 data 为 AccountProfile
          const account = expectOk(await provider.getAccountProfile());
          expect(isAccountProfile(account)).toBe(true);

          // 4) updateAccountProfile(input): 合法输入成功，返回 AccountProfile
          const updatedAccount = expectOk(
            await provider.updateAccountProfile(accountInput)
          );
          expect(isAccountProfile(updatedAccount)).toBe(true);

          // 5) getTodaySummary(): 汇总成功，返回 DailySummary
          const summaryAll = expectOk(await provider.getTodaySummary());
          expect(isDailySummary(summaryAll)).toBe(true);
          // 5b) getTodaySummary(deviceId): 单设备成功，返回 DailySummary
          const summaryOne = expectOk(
            await provider.getTodaySummary(someDeviceId)
          );
          expect(isDailySummary(summaryOne)).toBe(true);

          // 6) getWeeklyRecords(): 汇总成功，返回 ChargeDischargeRecord[]（恰好 7 条且良构）
          const weeklyAll = expectOk(await provider.getWeeklyRecords());
          expect(Array.isArray(weeklyAll)).toBe(true);
          expect(weeklyAll.length).toBe(7);
          expect(weeklyAll.every(isChargeDischargeRecord)).toBe(true);
          // 6b) getWeeklyRecords(deviceId): 单设备成功
          const weeklyOne = expectOk(
            await provider.getWeeklyRecords(someDeviceId)
          );
          expect(weeklyOne.every(isChargeDischargeRecord)).toBe(true);

          // 7) listStrategies(): 成功且 data 为 TradingStrategy[]（数组良构）
          const strategies = expectOk(await provider.listStrategies());
          expect(Array.isArray(strategies)).toBe(true);
          expect(strategies.every(isTradingStrategy)).toBe(true);
          expect(strategies.length).toBeGreaterThanOrEqual(1);

          // 8) createStrategy(input): 合法输入成功，返回 TradingStrategy
          const created = expectOk(await provider.createStrategy(strategyInput));
          expect(isTradingStrategy(created)).toBe(true);

          // 9) updateStrategy(id, patch): 已存在策略 + 仅切换 enabled，成功返回 TradingStrategy
          const updated = expectOk(
            await provider.updateStrategy(strategies[0].id, {
              enabled: enabledPatch,
            })
          );
          expect(isTradingStrategy(updated)).toBe(true);

          // 10) deleteStrategy(id): 删除刚创建的策略，成功返回 { id }
          const deleted = expectOk(await provider.deleteStrategy(created.id));
          expect(isDeleteResult(deleted)).toBe(true);

          // 11) getMarketState(): 成功且 data 为 MarketState（含 history 数组良构）
          const market = expectOk(await provider.getMarketState());
          expect(isMarketState(market)).toBe(true);

          return true;
        }
      ),
      FC_PARAMS
    );
  });

  // --------------------------------------------------------
  // shape-checker 自检：正向与反向（防止 checker 退化为恒真）
  // --------------------------------------------------------
  describe("shape-checker 自检", () => {
    it("合法样例通过，非法样例（缺字段 / 多字段 / 错类型 / 越枚举）被拒", () => {
      // Device：合法
      expect(
        isDevice({
          id: "device-001",
          name: "储能设备 001",
          connectionStatus: "online",
          lastReportedAt: "2024-06-15T11:59:30.000Z",
        })
      ).toBe(true);
      // Device：枚举越界
      expect(
        isDevice({
          id: "d",
          name: "n",
          connectionStatus: "unknown",
          lastReportedAt: "x",
        })
      ).toBe(false);
      // Device：缺字段
      expect(isDevice({ id: "d", name: "n", connectionStatus: "online" })).toBe(
        false
      );
      // Device：多余字段
      expect(
        isDevice({
          id: "d",
          name: "n",
          connectionStatus: "online",
          lastReportedAt: "x",
          extra: 1,
        })
      ).toBe(false);

      // DeviceDetail：合法 / 错类型
      expect(
        isDeviceDetail({
          id: "d",
          name: "n",
          connectionStatus: "offline",
          lastReportedAt: "x",
          lastStatusUpdatedAt: "y",
        })
      ).toBe(true);
      expect(
        isDeviceDetail({
          id: "d",
          name: "n",
          connectionStatus: "offline",
          lastReportedAt: "x",
          lastStatusUpdatedAt: 123,
        })
      ).toBe(false);

      // AccountProfile：合法 / 错类型
      expect(
        isAccountProfile({ name: "a", email: "b", phone: "c", address: "d" })
      ).toBe(true);
      expect(
        isAccountProfile({ name: 1, email: "b", phone: "c", address: "d" })
      ).toBe(false);

      // DailySummary：合法 / 日期格式错误 / 数值错类型
      expect(
        isDailySummary({
          date: "2024-06-15",
          totalChargeKwh: 1.23,
          totalDischargeKwh: 0,
        })
      ).toBe(true);
      expect(
        isDailySummary({
          date: "2024/06/15",
          totalChargeKwh: 1,
          totalDischargeKwh: 0,
        })
      ).toBe(false);
      expect(
        isDailySummary({
          date: "2024-06-15",
          totalChargeKwh: "1",
          totalDischargeKwh: 0,
        })
      ).toBe(false);

      // ChargeDischargeRecord：合法 / NaN 被拒
      expect(
        isChargeDischargeRecord({
          date: "2024-06-15",
          chargeKwh: 0,
          dischargeKwh: 5.5,
        })
      ).toBe(true);
      expect(
        isChargeDischargeRecord({
          date: "2024-06-15",
          chargeKwh: NaN,
          dischargeKwh: 0,
        })
      ).toBe(false);

      // TradingStrategy：合法 / comparator 越枚举
      const validStrategy = {
        id: "s1",
        name: "n",
        action: "charge",
        condition: { comparator: "greater_than", priceThreshold: 1 },
        enabled: true,
        triggered: false,
      };
      expect(isTradingStrategy(validStrategy)).toBe(true);
      expect(
        isTradingStrategy({
          ...validStrategy,
          condition: { comparator: "bogus", priceThreshold: 1 },
        })
      ).toBe(false);
      // TradingStrategy：action 越枚举
      expect(isTradingStrategy({ ...validStrategy, action: "hold" })).toBe(
        false
      );

      // StrategyActionRecord：合法 / 缺字段
      const validRecord = {
        strategyId: "s1",
        strategyName: "n",
        action: "sell",
        price: 2.5,
        triggeredAt: "2024-06-15T12:00:00.000Z",
      };
      expect(isStrategyActionRecord(validRecord)).toBe(true);
      const { price, ...missingPrice } = validRecord;
      void price;
      expect(isStrategyActionRecord(missingPrice)).toBe(false);

      // MarketState：合法（含良构 history）/ history 元素非法
      expect(isMarketState({ currentPrice: 1.5, history: [validRecord] })).toBe(
        true
      );
      expect(isMarketState({ currentPrice: 1.5, history: [{ bad: 1 }] })).toBe(
        false
      );
      expect(isMarketState({ currentPrice: 1.5, history: "not-array" })).toBe(
        false
      );

      // deleteStrategy 结果：合法 / 多字段
      expect(isDeleteResult({ id: "s1" })).toBe(true);
      expect(isDeleteResult({ id: "s1", name: "n" })).toBe(false);
    });
  });
});
