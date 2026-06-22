// 充放电记录的 fast-check 生成器（Arbitrary）
//
// 多账户模型（需求 6.4 / Property 21）下，生成的 ChargeDischargeRecord 携带
// 归属账户标识 accountId 与归属设备标识 deviceId。生成器接收二者作为参数，
// 便于为指定账户/设备批量生成记录并断言账户数据隔离。
//
// 设计要点：
// - chargeKwh / dischargeKwh 落在合法值域 [0, 999999999.99] 内（需求 3.7 / Property 8）。
// - date 为合法自然日字符串 YYYY-MM-DD。
//
// 对应需求：3.7、6.4（Property 8、Property 21）

import fc from "fast-check";
import type { ChargeDischargeRecord } from "@/lib/data-access/types";

/** 充放电量生成器：非负且落在合法值域 [0, 999999999.99]（需求 3.7） */
const kwhArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 999999999.99,
  noNaN: true,
});

/** 自然日生成器：年 2000–2100、月 1–12、日 1–28，保证为合法日期 */
const naturalDayArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2000, max: 2100 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );

/**
 * 生成归属指定账户与设备的 ChargeDischargeRecord。
 *
 * 参数:
 *   accountId (string): 归属账户标识（写入 accountId，需求 6.4）
 *   deviceId (string): 归属设备标识（写入 deviceId）
 *
 * 返回:
 *   fc.Arbitrary<ChargeDischargeRecord>: 携带归属字段的充放电记录生成器
 */
export function chargeDischargeRecordArb(
  accountId: string,
  deviceId: string
): fc.Arbitrary<ChargeDischargeRecord> {
  return fc.record({
    accountId: fc.constant(accountId),
    deviceId: fc.constant(deviceId),
    date: naturalDayArb,
    chargeKwh: kwhArb,
    dischargeKwh: kwhArb,
  });
}
