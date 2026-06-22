// Feature: energy-storage-management, Property 6: 当日总量等于各设备求和且格式化为 2 位小数
//
// 被测对象：lib/data-access/mock/mock-provider.ts 的 MockProvider.getTodaySummary
// Validates: Requirements 3.1
//
// 断言不变量（对所有合法种子数据成立）：
//   - getTodaySummary()（汇总，省略 deviceId）返回的 totalChargeKwh / totalDischargeKwh
//     等于对今天各设备分别调用 getTodaySummary(deviceId) 所得当日充/放电量之和；
//   - 汇总值与各设备分项值均已四舍五入到 2 位小数（value === round2(value)），
//     且其用于展示的格式化结果（toFixed(2)）恒为「保留 2 位小数」的字符串。
//
// 确定性：注入固定时钟（clock 恒返回同一 epoch 毫秒），并以 fast-check 生成的
// 多组 seed / deviceCount / recordDays 驱动 MockProvider，保证可复现（FC_PARAMS）。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { MAX_DEVICES } from "@/lib/data-access/mock/seed-data";
import type { Result, DailySummary, Device } from "@/lib/data-access/types";

// 固定「当前时间」基准（epoch 毫秒）：注入为 MockProvider 的时钟，保证确定性。
// 取一个远离精度边界的普通时间戳（约 2023-11-14）。
const FIXED_NOW = 1_700_000_000_000;

// 账户作用域查询入参：seed-data 默认账户以 account-001 起始编号。
const ACCOUNT_ID = "account-001";

/** 四舍五入保留 2 位小数（与被测实现一致的展示精度基准） */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 断言数值已处于 2 位小数精度，且其展示格式化结果为「保留 2 位小数」的字符串 */
function assertTwoDecimals(value: number): void {
  // 值本身已四舍五入到 2 位小数（不存在第 3 位有效小数）
  expect(value).toBe(round2(value));
  // 展示格式化恒为保留 2 位小数的字符串，如 "0.00" / "123.40"
  expect(value.toFixed(2)).toMatch(/^\d+\.\d{2}$/);
}

/** 从 Result 中取出成功数据，失败则直接让测试断言失败 */
function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`期望成功结果，实际失败：${result.error.type} ${result.error.message}`);
  }
  return result.data;
}

// —— 生成器：驱动 MockProvider 的确定性种子参数 ——

/** seed：32 位无符号整数范围内的任意值 */
const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

/**
 * deviceCount：覆盖 0 / 1 / 2 / 多设备（含汇总场景的关键规模）。
 * 上限保持适中以兼顾迭代速度，且远小于 MAX_DEVICES。
 */
const deviceCountArb = fc.integer({ min: 0, max: 40 });

/** recordDays：充放电记录覆盖天数（含当日），至少 1 天以保证当日可计算 */
const recordDaysArb = fc.integer({ min: 1, max: 14 });

describe("Property 6: 当日总量等于各设备求和且格式化为 2 位小数", () => {
  it("Feature: energy-storage-management, Property 6 - 汇总当日总量等于各设备求和且保留 2 位小数", async () => {
    await fc.assert(
      fc.asyncProperty(
        seedArb,
        deviceCountArb,
        recordDaysArb,
        async (seed, deviceCount, recordDays) => {
          // 注入固定时钟，保证「今天」判定与各次调用一致（确定性）
          const provider = new MockProvider({
            seed,
            clock: () => FIXED_NOW,
            deviceCount,
            recordDays,
          });

          // 取设备列表（id 与 recordsByDevice 键一致，且不超过 200 台）
          const devices: Device[] = expectOk(
            await provider.listDevices(ACCOUNT_ID)
          );
          expect(devices.length).toBeLessThanOrEqual(MAX_DEVICES);

          // 汇总（省略 deviceId）：当日全部设备求和
          const aggregate: DailySummary = expectOk(
            await provider.getTodaySummary(ACCOUNT_ID)
          );

          // 各设备分项：逐台调用 getTodaySummary(accountId, deviceId)
          let sumCharge = 0;
          let sumDischarge = 0;
          for (const device of devices) {
            const perDevice: DailySummary = expectOk(
              await provider.getTodaySummary(ACCOUNT_ID, device.id)
            );
            // 分项值同样应为 2 位小数精度
            assertTwoDecimals(perDevice.totalChargeKwh);
            assertTwoDecimals(perDevice.totalDischargeKwh);
            sumCharge += perDevice.totalChargeKwh;
            sumDischarge += perDevice.totalDischargeKwh;
          }

          // 汇总值应等于各设备分项求和（四舍五入到 2 位小数后比较，消除浮点累加噪声）
          expect(aggregate.totalChargeKwh).toBe(round2(sumCharge));
          expect(aggregate.totalDischargeKwh).toBe(round2(sumDischarge));

          // 汇总值亦为 2 位小数精度，且展示格式化为保留 2 位小数的字符串
          assertTwoDecimals(aggregate.totalChargeKwh);
          assertTwoDecimals(aggregate.totalDischargeKwh);

          // 汇总日期应为今天（与各分项一致）
          if (devices.length > 0) {
            expect(aggregate.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          }
        }
      ),
      FC_PARAMS
    );
  });
});
