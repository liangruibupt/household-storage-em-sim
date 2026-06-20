// Feature: energy-storage-management, Property 12: 策略删除后不可见
//
// 本文件实现设计文档中的 Property 12：对任意已存在的策略，调用 deleteStrategy(id)
// 成功后，listStrategies() 不再包含该策略；再次删除同一 id（或删除一个本不存在的
// id）返回结构化错误 NOT_FOUND。
//
// 被测对象：MockProvider.deleteStrategy + listStrategies（task 10.8）。
// 每个用例使用全新的 MockProvider 实例并注入固定时钟，保证确定性与隔离；
// 既复用种子初始策略，也通过 createStrategy 补充新建策略，覆盖更广的删除目标。
//
// Validates: Requirements 4.7

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { validTradingStrategyInput } from "@/test/arbitraries/strategy";

// 固定时钟基准（epoch 毫秒）：保证种子数据与读取派生完全确定。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

/** 构造一个使用固定时钟的全新 MockProvider，确保每个用例彼此隔离。 */
function freshProvider(seed: number): MockProvider {
  return new MockProvider({ seed, clock: () => FIXED_NOW });
}

describe("Property 12: 策略删除后不可见 (MockProvider.deleteStrategy)", () => {
  it("Feature: energy-storage-management, Property 12 — 删除成功后列表不再包含该 id，重复删除返回 NOT_FOUND", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 额外创建的若干合法策略，连同种子初始策略一起作为删除候选
        fc.array(validTradingStrategyInput, { minLength: 0, maxLength: 5 }),
        // 用于在候选列表中确定性地选取删除目标的索引基
        fc.nat(),
        // provider 种子
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (inputs, pickBase, seed) => {
          const provider = freshProvider(seed);

          // 先创建额外策略，扩充删除候选集合
          for (const input of inputs) {
            const created = await provider.createStrategy(input);
            expect(created.ok).toBe(true);
          }

          // 取删除前的完整策略列表
          const beforeResult = await provider.listStrategies();
          expect(beforeResult.ok).toBe(true);
          if (!beforeResult.ok) return;
          const before = beforeResult.data;

          // 候选集合可能为空（种子策略数为 0 且未额外创建）：
          // 此时删除任意 id 均应返回 NOT_FOUND（在下方专门用例覆盖），此处直接通过。
          if (before.length === 0) {
            const miss = await provider.deleteStrategy("strategy-nonexistent");
            expect(miss.ok).toBe(false);
            if (miss.ok) return;
            expect(miss.error.type).toBe("NOT_FOUND");
            return;
          }

          // 确定性选取一个已存在的策略 id 作为删除目标
          const target = before[pickBase % before.length];

          // 删除成功并回显被删除的 id（需求 4.7）
          const delResult = await provider.deleteStrategy(target.id);
          expect(delResult.ok).toBe(true);
          if (!delResult.ok) return;
          expect(delResult.data.id).toBe(target.id);

          // 删除后：列表不再包含该 id，且总数恰好减少 1
          const afterResult = await provider.listStrategies();
          expect(afterResult.ok).toBe(true);
          if (!afterResult.ok) return;
          const after = afterResult.data;

          expect(after.some((s) => s.id === target.id)).toBe(false);
          expect(after.length).toBe(before.length - 1);

          // 其余策略不受影响：删除前除目标外的 id 集合 == 删除后的 id 集合
          const expectedRemaining = before
            .filter((s) => s.id !== target.id)
            .map((s) => s.id)
            .sort();
          const actualRemaining = after.map((s) => s.id).sort();
          expect(actualRemaining).toEqual(expectedRemaining);

          // 重复删除同一 id：现已不存在，返回 NOT_FOUND（需求 4.7）
          const repeat = await provider.deleteStrategy(target.id);
          expect(repeat.ok).toBe(false);
          if (repeat.ok) return;
          expect(repeat.error.type).toBe("NOT_FOUND");
        }
      ),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 12 — 删除本不存在的 id 始终返回 NOT_FOUND", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 任意非空标识串作为「不存在的 id」
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (rawId, seed) => {
          const provider = freshProvider(seed);

          // 取当前已存在的 id 集合，确保我们构造的 id 确实不存在
          const listResult = await provider.listStrategies();
          expect(listResult.ok).toBe(true);
          if (!listResult.ok) return;
          const existingIds = new Set(listResult.data.map((s) => s.id));

          // 以固定前缀拼接随机串，避免与系统生成的 "strategy-NNN" 形式冲突
          let missingId = `missing-${rawId}`;
          while (existingIds.has(missingId)) {
            missingId = `missing-${missingId}`;
          }

          const result = await provider.deleteStrategy(missingId);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.type).toBe("NOT_FOUND");

          // 删除失败不得改动内存：策略列表保持不变
          const afterResult = await provider.listStrategies();
          expect(afterResult.ok).toBe(true);
          if (!afterResult.ok) return;
          expect(afterResult.data.map((s) => s.id).sort()).toEqual(
            [...existingIds].sort()
          );
        }
      ),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 代表性示例（单元测试）：覆盖创建后删除、空候选、不存在 id 等典型场景
  // ----------------------------------------------------------
  describe("代表性示例", () => {
    it("创建一条策略后删除，列表不再包含且重复删除返回 NOT_FOUND", async () => {
      const provider = freshProvider(7);
      const created = await provider.createStrategy({
        name: "to-delete",
        action: "discharge",
        condition: { comparator: "less_than", priceThreshold: 1.5 },
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      const del = await provider.deleteStrategy(id);
      expect(del.ok).toBe(true);
      if (!del.ok) return;
      expect(del.data.id).toBe(id);

      const list = await provider.listStrategies();
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.data.some((s) => s.id === id)).toBe(false);

      const again = await provider.deleteStrategy(id);
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.error.type).toBe("NOT_FOUND");
    });

    it("删除从未存在的 id 返回 NOT_FOUND", async () => {
      const provider = freshProvider(8);
      const result = await provider.deleteStrategy("definitely-not-here");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("NOT_FOUND");
    });

    it("删除空候选集合（strategyCount=0）中的任意 id 返回 NOT_FOUND", async () => {
      const provider = new MockProvider({
        seed: 9,
        clock: () => FIXED_NOW,
        strategyCount: 0,
      });
      const list = await provider.listStrategies();
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.data.length).toBe(0);

      const result = await provider.deleteStrategy("strategy-001");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("NOT_FOUND");
    });
  });
});
