// Feature: energy-storage-management, Property 13: 触发去抖单次记录与重置
//
// 被测对象：lib/domain/trigger.ts 的 evaluateTrigger / isConditionSatisfied
// Validates: Requirements 4.10
//
// 断言不变量（对所有合法电价序列与启用中策略成立）：
//   - 在条件「持续满足」的每一段连续区间内，最多记录一次对应动作；
//   - 一旦条件不再满足，去抖状态重置，使后续再次进入满足区间时可再记录一次；
//   - 因此：沿电价序列折叠 evaluateTrigger 得到的「记录次数」恰好等于
//     序列中「极大连续满足区间」的数量；
//   - 每步 nextTriggered 恒等于该步是否满足条件；
//   - 每步 shouldRecord 恒等于「满足条件且此前未触发」。
//
// 覆盖场景：持续满足序列、跌出后再进入、全部 5 种 comparator。

import { describe, it } from "vitest";
import fc from "fast-check";
import { evaluateTrigger, isConditionSatisfied } from "@/lib/domain/trigger";
import type { PriceComparator, TriggerCondition } from "@/lib/data-access/types";
import { FC_PARAMS } from "@/test/fc-config";

// —— Arbitrary 定义 ——

/** 全部 5 种比较关系（需求 4.5） */
const comparatorArb = fc.constantFrom<PriceComparator>(
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal"
);

/** 电价阈值，落在合法值域 [0, 999999.99]（需求 4.9） */
const thresholdArb = fc.double({ min: 0, max: 999999.99, noNaN: true });

/**
 * 单步电价生成：以「相对阈值」的方式构造，使序列能够频繁地跨越阈值，
 * 从而触发「满足 -> 不满足 -> 满足」的转换；snapToThreshold 用于命中 equal 比较关系。
 */
const stepArb = fc.record({
  snapToThreshold: fc.boolean(),
  delta: fc.double({ min: -50, max: 50, noNaN: true }),
});

/** 折叠 evaluateTrigger 的模拟结果与不变量校验 */
function simulateAndCheck(
  comparator: PriceComparator,
  threshold: number,
  prices: number[]
): boolean {
  const condition: TriggerCondition = { comparator, priceThreshold: threshold };

  // 沿序列折叠，统计记录次数并逐步校验单步不变量
  let prevTriggered = false;
  let recordCount = 0;
  for (const price of prices) {
    const { shouldRecord, nextTriggered } = evaluateTrigger(
      prevTriggered,
      condition,
      price
    );
    const satisfied = isConditionSatisfied(comparator, price, threshold);

    // 单步不变量 1：nextTriggered 恒等于「本步是否满足条件」（满足则置位，不满足则重置）
    if (nextTriggered !== satisfied) return false;

    // 单步不变量 2：shouldRecord 恒等于「满足且此前未触发」
    if (shouldRecord !== (satisfied && !prevTriggered)) return false;

    if (shouldRecord) recordCount++;
    prevTriggered = nextTriggered;
  }

  // 整体不变量：记录次数 == 极大连续满足区间数量
  let satisfiedRuns = 0;
  let inRun = false;
  for (const price of prices) {
    const satisfied = isConditionSatisfied(comparator, price, threshold);
    if (satisfied && !inRun) {
      satisfiedRuns++;
      inRun = true;
    } else if (!satisfied) {
      inRun = false;
    }
  }

  return recordCount === satisfiedRuns;
}

describe("Property 13: 触发去抖单次记录与重置", () => {
  it("对任意 comparator/阈值/电价序列，记录次数等于极大连续满足区间数量", () => {
    fc.assert(
      fc.property(
        comparatorArb,
        thresholdArb,
        fc.array(stepArb, { minLength: 0, maxLength: 40 }),
        (comparator, threshold, steps) => {
          const prices = steps.map((s) =>
            s.snapToThreshold ? threshold : threshold + s.delta
          );
          return simulateAndCheck(comparator, threshold, prices);
        }
      ),
      FC_PARAMS
    );
  });

  it("持续满足序列：整段连续满足时恰好记录一次（仅首步），其后均不重复记录", () => {
    // 使用 greater_than：取严格大于阈值的电价（threshold + 正增量）保证持续满足
    const scenario = fc.record({
      threshold: thresholdArb,
      positiveDeltas: fc.array(fc.double({ min: 0.01, max: 100, noNaN: true }), {
        minLength: 1,
        maxLength: 30,
      }),
    });
    fc.assert(
      fc.property(scenario, ({ threshold, positiveDeltas }) => {
        const condition: TriggerCondition = {
          comparator: "greater_than",
          priceThreshold: threshold,
        };
        const prices = positiveDeltas.map((d) => threshold + d);

        let prevTriggered = false;
        let recordCount = 0;
        const recordFlags: boolean[] = [];
        for (const price of prices) {
          const { shouldRecord, nextTriggered } = evaluateTrigger(
            prevTriggered,
            condition,
            price
          );
          recordFlags.push(shouldRecord);
          if (shouldRecord) recordCount++;
          prevTriggered = nextTriggered;
        }

        // 恰好记录一次，且仅在第一步记录，后续步均为 false
        if (recordCount !== 1) return false;
        if (recordFlags[0] !== true) return false;
        return recordFlags.slice(1).every((f) => f === false);
      }),
      FC_PARAMS
    );
  });

  it("跌出后再进入：满足段 -> 不满足段 -> 满足段 会再次记录（共 2 次）", () => {
    // 使用 greater_or_equal：满足价为 threshold + 非负增量，不满足价为 threshold - (正数)
    const scenario = fc.record({
      threshold: thresholdArb,
      firstRun: fc.integer({ min: 1, max: 10 }), // 第一段满足步数
      gap: fc.integer({ min: 1, max: 10 }), // 中间不满足步数
      secondRun: fc.integer({ min: 1, max: 10 }), // 第二段满足步数
      satOffset: fc.double({ min: 0, max: 100, noNaN: true }),
      unsatOffset: fc.double({ min: 0.01, max: 100, noNaN: true }),
    });
    fc.assert(
      fc.property(
        scenario,
        ({ threshold, firstRun, gap, secondRun, satOffset, unsatOffset }) => {
          const condition: TriggerCondition = {
            comparator: "greater_or_equal",
            priceThreshold: threshold,
          };
          const satPrice = threshold + satOffset; // >= threshold，满足
          const unsatPrice = threshold - unsatOffset; // < threshold，不满足

          const prices: number[] = [
            ...Array(firstRun).fill(satPrice),
            ...Array(gap).fill(unsatPrice),
            ...Array(secondRun).fill(satPrice),
          ];

          let prevTriggered = false;
          let recordCount = 0;
          for (const price of prices) {
            const { shouldRecord, nextTriggered } = evaluateTrigger(
              prevTriggered,
              condition,
              price
            );
            if (shouldRecord) recordCount++;
            prevTriggered = nextTriggered;
          }

          // 两段独立的满足区间，应各记录一次，共 2 次
          return recordCount === 2;
        }
      ),
      FC_PARAMS
    );
  });

  it("覆盖全部 5 种 comparator：每种比较关系下不变量均成立", () => {
    // 针对每种 comparator 独立验证「记录次数 == 满足区间数量」
    fc.assert(
      fc.property(
        comparatorArb,
        thresholdArb,
        fc.array(stepArb, { minLength: 1, maxLength: 40 }),
        (comparator, threshold, steps) => {
          const prices = steps.map((s) =>
            s.snapToThreshold ? threshold : threshold + s.delta
          );
          return simulateAndCheck(comparator, threshold, prices);
        }
      ),
      FC_PARAMS
    );
  });
});
