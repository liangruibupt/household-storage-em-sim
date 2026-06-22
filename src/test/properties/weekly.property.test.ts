// Feature: energy-storage-management, Property 7: 7 天数据集合不变量（含零填充）
//
// 被测对象：lib/domain/weekly.ts 的 buildWeeklyRecords
// Validates: Requirements 3.2, 3.3, 3.5
//
// 断言不变量（对所有合法输入成立）：
//   - 输出长度恰好为 7；
//   - 日期为「含当日在内、向前回溯」的 7 个连续自然日；
//   - 按日期严格升序排列（相邻两日恰好相差 1 个自然日）；
//   - 末条记录的自然日等于 today 的自然日；
//   - 每个自然日恰好对应一条记录（由连续性 + 长度 7 保证无重复、无遗漏）；
//   - 命中原始数据的自然日，其 charge/discharge 等于原始首次出现记录的值；
//   - 原始数据缺失的自然日，其 chargeKwh 与 dischargeKwh 均为 0（零填充）。
//
// 覆盖场景：空集合、部分缺失、全覆盖、跨月边界。

import { describe, it } from "vitest";
import fc from "fast-check";
import { buildWeeklyRecords } from "@/lib/domain/weekly";
import type { ChargeDischargeRecord } from "@/lib/data-access/types";
import { FC_PARAMS } from "@/test/fc-config";

// —— 测试内独立的自然日工具（作为校验 oracle，与被测实现保持同一本地日历基准）——

/** 将本地日历分量格式化为 YYYY-MM-DD 定长字符串 */
function formatDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 解析 YYYY-MM-DD 为本地 Date（取正午，规避 DST 边界对日历分量的影响） */
function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** 由 today 与「距今偏移天数」构造该自然日的 YYYY-MM-DD（offset 正数表示更早） */
function dayKeyFromOffset(today: Date, offset: number): string {
  return formatDay(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
  );
}

// —— 通用 Arbitrary ——

/** 非负且落在值域内的充放电量（需求 3.7 的边界由其它属性覆盖，这里取合法范围内的值） */
const kwhArb = fc.double({ min: 0, max: 999999999.99, noNaN: true });

/**
 * today 生成器：取正午时刻，避免午夜在某些时区的 DST 边界问题。
 * day 限定 1-28 保证在任意月份均为合法日期；day=1 会触发向前回溯跨月。
 */
const todayArb = fc
  .record({
    year: fc.integer({ min: 2000, max: 2100 }),
    month: fc.integer({ min: 0, max: 11 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => new Date(year, month, day, 12, 0, 0));

/**
 * 单条原始记录生成器：以「距今偏移」表达日期，范围覆盖窗口内（0..6）与窗口外噪声
 * （-3..-1 表示未来日、7..9 表示更早的过期日），并允许同一偏移重复以验证「保留首次出现」。
 */
const rawEntryArb = fc.record({
  offset: fc.integer({ min: -3, max: 9 }),
  chargeKwh: kwhArb,
  dischargeKwh: kwhArb,
});

/** 将偏移型原始条目映射为带具体日期字符串的 ChargeDischargeRecord[] */
function buildRaw(
  today: Date,
  entries: { offset: number; chargeKwh: number; dischargeKwh: number }[]
): ChargeDischargeRecord[] {
  return entries.map((e) => ({
    // 多账户模型下记录携带归属字段；buildWeeklyRecords 仅依赖 date/charge/discharge，
    // 此处填入固定归属以满足类型契约（需求 6.4）。
    accountId: "account-001",
    deviceId: "device-001",
    date: dayKeyFromOffset(today, e.offset),
    chargeKwh: e.chargeKwh,
    dischargeKwh: e.dischargeKwh,
  }));
}

/**
 * 校验 buildWeeklyRecords 输出的全部不变量。返回 true 表示通过。
 * raw 为传入被测函数的原始记录，today 为基准日。
 */
function checkInvariants(raw: ChargeDischargeRecord[], today: Date): boolean {
  const out = buildWeeklyRecords(raw, today);

  // 1) 长度恰好为 7
  if (out.length !== 7) return false;

  // 期望的 7 个自然日键（offset 6..0 升序），作为日期序列 oracle
  const expectedKeys: string[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    expectedKeys.push(dayKeyFromOffset(today, offset));
  }

  // 原始数据按「首次出现」建立索引，作为命中/零填充 oracle
  const rawByDate = new Map<string, ChargeDischargeRecord>();
  for (const r of raw) {
    if (!rawByDate.has(r.date)) rawByDate.set(r.date, r);
  }

  for (let i = 0; i < 7; i++) {
    const rec = out[i];

    // 2) 日期等于期望键（含当日、向前回溯的连续自然日，且按升序）
    if (rec.date !== expectedKeys[i]) return false;

    // 3) 命中则取首次出现值，缺失则零填充
    const matched = rawByDate.get(rec.date);
    const expCharge = matched ? matched.chargeKwh : 0;
    const expDischarge = matched ? matched.dischargeKwh : 0;
    if (rec.chargeKwh !== expCharge) return false;
    if (rec.dischargeKwh !== expDischarge) return false;
  }

  // 4) 相邻两日严格相差 1 个自然日（保证严格升序 + 连续 + 唯一）
  for (let i = 1; i < 7; i++) {
    const prev = parseDay(out[i - 1].date);
    const expectedNext = formatDay(
      new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)
    );
    if (out[i].date !== expectedNext) return false;
  }

  // 5) 末条自然日等于 today 的自然日
  if (out[6].date !== formatDay(today)) return false;

  return true;
}

describe("Property 7: 7 天数据集合不变量（含零填充）", () => {
  it("对任意 today 与原始记录集合，输出满足全部 7 天集合不变量（含部分缺失噪声）", () => {
    fc.assert(
      fc.property(
        todayArb,
        fc.array(rawEntryArb, { minLength: 0, maxLength: 20 }),
        (today, entries) => checkInvariants(buildRaw(today, entries), today)
      ),
      FC_PARAMS
    );
  });

  it("空集合：输出恰好 7 条且全部零填充", () => {
    fc.assert(
      fc.property(todayArb, (today) => {
        const out = buildWeeklyRecords([], today);
        if (out.length !== 7) return false;
        return out.every((r) => r.chargeKwh === 0 && r.dischargeKwh === 0);
      }),
      FC_PARAMS
    );
  });

  it("全覆盖：7 个窗口日均有原始记录时，逐日值与原始数据一致且无零填充缺失", () => {
    // 为窗口内 7 天每天各生成一条记录，断言往返一致
    const fullArb = fc.record({
      today: todayArb,
      values: fc.array(
        fc.record({ chargeKwh: kwhArb, dischargeKwh: kwhArb }),
        { minLength: 7, maxLength: 7 }
      ),
    });
    fc.assert(
      fc.property(fullArb, ({ today, values }) => {
        // values[0] 对应最早一天（offset 6），values[6] 对应当日（offset 0）
        const raw: ChargeDischargeRecord[] = values.map((v, idx) => ({
          accountId: "account-001",
          deviceId: "device-001",
          date: dayKeyFromOffset(today, 6 - idx),
          chargeKwh: v.chargeKwh,
          dischargeKwh: v.dischargeKwh,
        }));
        const out = buildWeeklyRecords(raw, today);
        if (out.length !== 7) return false;
        // 不变量整体成立
        if (!checkInvariants(raw, today)) return false;
        // 且每一天都精确等于对应原始值（即无任何零填充覆盖真实数据）
        for (let i = 0; i < 7; i++) {
          if (out[i].chargeKwh !== values[i].chargeKwh) return false;
          if (out[i].dischargeKwh !== values[i].dischargeKwh) return false;
        }
        return true;
      }),
      FC_PARAMS
    );
  });

  it("跨月边界：当 today 接近月初时，回溯窗口跨入上一个月仍满足全部不变量", () => {
    // day 限定 1-6，确保向前回溯 6 天必定跨入上一个月
    const crossMonthToday = fc
      .record({
        year: fc.integer({ min: 2000, max: 2100 }),
        month: fc.integer({ min: 0, max: 11 }),
        day: fc.integer({ min: 1, max: 6 }),
      })
      .map(({ year, month, day }) => new Date(year, month, day, 12, 0, 0));

    fc.assert(
      fc.property(
        crossMonthToday,
        fc.array(rawEntryArb, { minLength: 0, maxLength: 20 }),
        (today, entries) => {
          const raw = buildRaw(today, entries);
          const out = buildWeeklyRecords(raw, today);
          // 至少一条记录落在与 today 不同的月份（验证确实跨月）
          const crossed = out.some(
            (r) => parseDay(r.date).getMonth() !== today.getMonth()
          );
          if (!crossed) return false;
          return checkInvariants(raw, today);
        }
      ),
      FC_PARAMS
    );
  });
});
