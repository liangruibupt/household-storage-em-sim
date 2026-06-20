// Feature: energy-storage-management, Property 14: 触发历史倒序且截断
//
// 本文件实现设计文档中的 Property 14：无论发生多少次触发，
// getMarketState().history 必须满足两条不变量（需求 4.11）：
//   1) 按时间倒序排列（最新在前）：相邻记录的 triggeredAt 时间戳非递增；
//   2) 至多保留 50 条：history.length <= 50，即便触发次数超过 50 也不例外。
//
// 被测对象：MockProvider 的内置触发引擎 + getMarketState（task 10.8）。
// 制造大量触发的手段：
//   - 构造 MockProvider（strategyCount: 0，避免种子策略干扰），
//     通过 createStrategy 创建若干「启用且条件必定满足」的策略
//     （如 greater_or_equal 阈值 0；电价恒 ≥ 0 故必触发）；
//   - 注入「单调递增时钟」，使每次 getMarketState 的触发时间戳严格递增，
//     从而验证倒序（最新在前）在跨多次调用时依然成立；
//   - 多次调用 getMarketState（每次推进电价并运行触发引擎）。
//
// Validates: Requirements 4.11

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import type {
  PriceComparator,
  StrategyActionRecord,
  TradingStrategyInput,
} from "@/lib/data-access/types";

// 触发历史上限（与 MockProvider 内部 MAX_HISTORY 一致，需求 4.11）
const MAX_HISTORY = 50;

// 时钟基准（epoch 毫秒）与单步增量（毫秒）。
// 增量 1000ms 保证每次调用产生互异且严格递增的 ISO 秒级时间戳。
const CLOCK_BASE = Date.parse("2024-06-15T00:00:00.000Z");
const CLOCK_STEP = 1000;

/**
 * 构造一个使用「单调递增时钟」的全新 MockProvider。
 * 时钟每被调用一次（构造期一次、每次 getMarketState 一次）即推进 CLOCK_STEP，
 * 从而保证触发时间戳单调递增、互不相同。
 *
 * @param seed 随机种子，保证可复现
 * @returns MockProvider 实例（不含初始种子策略）
 */
function freshProviderWithAdvancingClock(seed: number): MockProvider {
  let tick = 0;
  const clock = () => CLOCK_BASE + tick++ * CLOCK_STEP;
  return new MockProvider({ seed, clock, strategyCount: 0 });
}

/** 断言时间戳序列「非递增」（最新在前，需求 4.11）。 */
function expectNonIncreasingTimestamps(history: StrategyActionRecord[]): void {
  const times = history.map((r) => Date.parse(r.triggeredAt));
  for (let i = 0; i + 1 < times.length; i++) {
    // 倒序：前一条（更新）的时间戳应 ≥ 后一条（更旧）
    expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
  }
}

/** 必定触发的触发条件：电价恒 ≥ 0，故 greater_or_equal 阈值 0 永远满足。 */
const alwaysFireCondition = fc.constant({
  comparator: "greater_or_equal" as PriceComparator,
  priceThreshold: 0,
});

/**
 * 振荡型触发条件：阈值落在电价取值区间 [0, 3] 内，
 * 配合随机比较关系，使条件随电价波动而反复进入/退出，制造跨多次调用的触发与重置。
 */
const oscillatingCondition = fc.record({
  comparator: fc.constantFrom<PriceComparator>(
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
    "equal"
  ),
  priceThreshold: fc.double({ min: 0, max: 3, noNaN: true }),
});

/** 单条策略的触发条件生成器：偏重「必定触发」以更容易超过 50 条上限。 */
const conditionArb = fc.oneof(
  { weight: 2, arbitrary: alwaysFireCondition },
  { weight: 1, arbitrary: oscillatingCondition }
);

/**
 * 触发场景生成器：
 * - seed：随机种子；
 * - conditions：1..70 条策略的触发条件（length 可超过 50，用于触发截断路径）；
 * - calls：1..40 次 getMarketState 调用。
 */
const scenarioArb = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fffffff }),
  conditions: fc.array(conditionArb, { minLength: 1, maxLength: 70 }),
  calls: fc.integer({ min: 1, max: 40 }),
});

describe("Property 14: 触发历史倒序且截断 (MockProvider.getMarketState)", () => {
  it("Feature: energy-storage-management, Property 14 — history 倒序且至多 50 条，即便触发次数超过 50", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ seed, conditions, calls }) => {
        const provider = freshProviderWithAdvancingClock(seed);

        // 创建若干启用策略；条件多为「必定满足」，从而在调用时大量触发
        for (let i = 0; i < conditions.length; i++) {
          const input: TradingStrategyInput = {
            name: `s${i + 1}`,
            action: "charge",
            condition: conditions[i],
            enabled: true,
          };
          const created = await provider.createStrategy(input);
          expect(created.ok).toBe(true);
        }

        // 多次调用 getMarketState：每次推进电价并运行触发引擎
        let lastHistory: StrategyActionRecord[] = [];
        for (let c = 0; c < calls; c++) {
          const state = await provider.getMarketState();
          expect(state.ok).toBe(true);
          if (!state.ok) return;
          lastHistory = state.data.history;

          // 不变量必须在每次调用后都成立
          expect(lastHistory.length).toBeLessThanOrEqual(MAX_HISTORY);
          expectNonIncreasingTimestamps(lastHistory);
        }

        // 终态再次确认两条不变量（需求 4.11）
        expect(lastHistory.length).toBeLessThanOrEqual(MAX_HISTORY);
        expectNonIncreasingTimestamps(lastHistory);
      }),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 代表性示例（单元测试）
  // ----------------------------------------------------------
  describe("代表性示例", () => {
    it("单次调用 60 条必触发策略 → 历史精确截断至 50 条（>50 触发）", async () => {
      const provider = freshProviderWithAdvancingClock(7);

      // 创建 60 条启用且必定触发的策略（数量 > 50）
      for (let i = 0; i < 60; i++) {
        const created = await provider.createStrategy({
          name: `bulk-${i + 1}`,
          action: "discharge",
          condition: { comparator: "greater_or_equal", priceThreshold: 0 },
          enabled: true,
        });
        expect(created.ok).toBe(true);
      }

      // 单次调用即可让 60 条策略全部触发一次 → 应被截断至 50 条
      const state = await provider.getMarketState();
      expect(state.ok).toBe(true);
      if (!state.ok) return;

      expect(state.data.history.length).toBe(MAX_HISTORY);
      // 同一次调用内的触发共享同一时间戳，非递增（相等）成立
      expectNonIncreasingTimestamps(state.data.history);
    });

    it("跨多次调用 → 时间戳严格递减（最新在前），且条数受 50 上限约束", async () => {
      const provider = freshProviderWithAdvancingClock(11);

      // 单条必触发策略；每次调用后重置去抖状态以便下一次再触发
      const created = await provider.createStrategy({
        name: "repeater",
        action: "buy",
        condition: { comparator: "greater_or_equal", priceThreshold: 0 },
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      const ROUNDS = 5;
      for (let r = 0; r < ROUNDS; r++) {
        const state = await provider.getMarketState();
        expect(state.ok).toBe(true);
        // 通过更新触发条件重置去抖状态（condition 变更会令 triggered=false），
        // 使下一次调用能在「更晚的时间戳」上再次触发。
        const updated = await provider.updateStrategy(id, {
          condition: { comparator: "greater_or_equal", priceThreshold: 0 },
        });
        expect(updated.ok).toBe(true);
      }

      const finalState = await provider.getMarketState();
      expect(finalState.ok).toBe(true);
      if (!finalState.ok) return;

      const history = finalState.data.history;
      // 共触发 ROUNDS + 1 次（每轮一次 + 终态一次），均 ≤ 50
      expect(history.length).toBe(ROUNDS + 1);
      expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);

      // 时间戳严格递减：最新在前
      const times = history.map((rec) => Date.parse(rec.triggeredAt));
      for (let i = 0; i + 1 < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i + 1]);
      }
    });
  });
});
