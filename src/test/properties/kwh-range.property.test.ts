// Feature: energy-storage-management, Property 8: 充放电值域不变量
//
// 被测对象：lib/data-access/mock/mock-provider.ts 的 MockProvider
//   - getWeeklyRecords(deviceId?)：返回 7 天（含零填充）的 chargeKwh / dischargeKwh
//   - getTodaySummary(deviceId?)：返回当日总充 / 总放电量
//
// Validates: Requirements 3.7
//
// 断言不变量（对任意种子数据成立）：
//   DataAccessLayer 返回的所有 chargeKwh 与 dischargeKwh 都为非负且落在
//   区间 [0, 999999999.99] 内（即 CHARGE_DISCHARGE_MIN ≤ v ≤ CHARGE_DISCHARGE_MAX）。
//
// 覆盖边界：
//   - 下界 0：通过 recordDays=1 使 7 天窗口的其余 6 天经零填充返回精确的 0；
//   - 上界 999999999.99：显式断言该上界值被值域不变量判定为合法（边界含）。
//
// 复现性：使用 MockProvider + 固定注入时钟（clock）+ 变化的 seed，
//   并统一采用 FC_PARAMS（numRuns >= 100，确定性 seed）。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import {
  CHARGE_DISCHARGE_MAX,
  CHARGE_DISCHARGE_MIN,
} from "@/lib/data-access/mock/seed-data";
import type {
  ChargeDischargeRecord,
  DailySummary,
  Result,
} from "@/lib/data-access/types";

// 固定的「当前时间」基准（epoch 毫秒），注入为确定性时钟。
// 任意固定值即可；选取一个远离精度边界的常规时间戳。
const FIXED_NOW = 1_700_000_000_000;

// 账户作用域查询入参：seed-data 默认账户以 account-001 起始编号。
const ACCOUNT_ID = "account-001";

/** 构造一个使用固定时钟的 MockProvider */
function makeProvider(opts: {
  seed: number;
  deviceCount: number;
  recordDays: number;
}): MockProvider {
  return new MockProvider({
    seed: opts.seed,
    clock: () => FIXED_NOW,
    deviceCount: opts.deviceCount,
    recordDays: opts.recordDays,
    strategyCount: 0,
  });
}

/** 判定单个充放电数值是否落在合法值域 [0, 999999999.99]（含两端） */
function inRange(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= CHARGE_DISCHARGE_MIN &&
    value <= CHARGE_DISCHARGE_MAX
  );
}

/** 从 Result 中取出 data；失败时直接断言失败（本属性下不应出现失败分支） */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error.type}`);
  }
  return result.data;
}

/** 收集一台/全部设备的全部 chargeKwh 与 dischargeKwh 值（账户作用域，需求 6.5） */
async function collectKwhValues(
  provider: MockProvider,
  deviceId?: string
): Promise<number[]> {
  const values: number[] = [];

  const weekly: ChargeDischargeRecord[] = unwrap(
    await provider.getWeeklyRecords(ACCOUNT_ID, deviceId)
  );
  for (const r of weekly) {
    values.push(r.chargeKwh, r.dischargeKwh);
  }

  const summary: DailySummary = unwrap(
    await provider.getTodaySummary(ACCOUNT_ID, deviceId)
  );
  values.push(summary.totalChargeKwh, summary.totalDischargeKwh);

  return values;
}

describe("Property 8: 充放电值域不变量", () => {
  // 主属性：对任意 seed 与设备/记录规模，getWeeklyRecords 与 getTodaySummary
  // 返回的所有 chargeKwh / dischargeKwh 均落在 [0, 999999999.99] 内。
  it("Feature: energy-storage-management, Property 8 - 所有充放电值落在 [0, 999999999.99]", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 变化的 seed，覆盖不同的确定性种子数据
        fc.integer({ min: 0, max: 0x7fffffff }),
        // 设备数量覆盖 0 / 1 / 多台（含较大规模以放大跨设备聚合）
        fc.integer({ min: 0, max: 200 }),
        // 记录天数覆盖 1（触发零填充）至 14（覆盖完整 7 天窗口及更多）
        fc.integer({ min: 1, max: 14 }),
        async (seed, deviceCount, recordDays) => {
          const provider = makeProvider({ seed, deviceCount, recordDays });

          // 1) 全部设备汇总视角
          const aggregated = await collectKwhValues(provider);
          for (const v of aggregated) {
            expect(inRange(v)).toBe(true);
          }

          // 2) 逐台设备视角（覆盖单设备路径）
          const devices = unwrap(await provider.listDevices(ACCOUNT_ID));
          for (const d of devices) {
            const perDevice = await collectKwhValues(provider, d.id);
            for (const v of perDevice) {
              expect(inRange(v)).toBe(true);
            }
          }
        }
      ),
      FC_PARAMS
    );
  });

  // 边界覆盖（下界 0）：recordDays=1 时，7 天窗口仅当日有记录，
  // 其余 6 天经零填充返回精确的 0，从而真实出现下界值且仍在合法值域内。
  it("覆盖下界 0：零填充日的充放电值恰为 0 且在值域内", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (seed) => {
          const provider = makeProvider({
            seed,
            deviceCount: 1,
            recordDays: 1,
          });

          const weekly = unwrap(await provider.getWeeklyRecords(ACCOUNT_ID));
          // 窗口共 7 天，仅当日有数据 → 至少存在零填充日
          const zeroFilled = weekly.filter(
            (r) => r.chargeKwh === 0 && r.dischargeKwh === 0
          );
          expect(zeroFilled.length).toBeGreaterThanOrEqual(1);
          // 全部值仍落在合法值域内（含下界 0）
          for (const r of weekly) {
            expect(inRange(r.chargeKwh)).toBe(true);
            expect(inRange(r.dischargeKwh)).toBe(true);
          }
        }
      ),
      FC_PARAMS
    );
  });

  // 边界覆盖（上界 999999999.99）：显式断言上界值被值域不变量判定为合法，
  // 且严格超过上界（999999999.99 + 0.01）被判定为非法，确认边界含右端点。
  it("覆盖上界 999999999.99：边界值合法、越界值非法（边界含右端点）", () => {
    expect(CHARGE_DISCHARGE_MAX).toBe(999999999.99);
    expect(CHARGE_DISCHARGE_MIN).toBe(0);

    // 两个边界端点均在值域内
    expect(inRange(CHARGE_DISCHARGE_MIN)).toBe(true); // 0
    expect(inRange(CHARGE_DISCHARGE_MAX)).toBe(true); // 999999999.99

    // 越界值（无论上溢、下溢、NaN）均不在值域内
    expect(inRange(CHARGE_DISCHARGE_MAX + 0.01)).toBe(false);
    expect(inRange(-0.01)).toBe(false);
    expect(inRange(Number.NaN)).toBe(false);
  });
});
