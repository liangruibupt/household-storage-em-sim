// Feature: energy-storage-management, Property 9: 策略创建往返一致
//
// 本文件实现设计文档中的 Property 9：对任意通过校验的合法 TradingStrategyInput
// （含合法 action ∈ 4 种、合法 comparator ∈ 5 种），createStrategy(input) 成功后，
// listStrategies() 中存在一条记录，其名称、触发条件（comparator + priceThreshold）、
// 动作与启用状态均与 input 等价；新建策略 triggered=false 且具有系统生成的非空 id。
//
// 被测对象：MockProvider.createStrategy + listStrategies（task 10.8）。
// 每个用例使用全新的 MockProvider 实例并注入固定时钟，保证确定性与隔离。
//
// Validates: Requirements 4.3, 4.4, 4.5

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { validTradingStrategyInput } from "@/test/arbitraries/strategy";

// 固定时钟基准（epoch 毫秒）：保证种子数据与读取派生完全确定。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

// 账户作用域入参：seed-data 默认账户以 account-001 起始编号。
const ACCOUNT_ID = "account-001";

/** 构造一个使用固定时钟的全新 MockProvider，确保每个用例彼此隔离。 */
function freshProvider(seed: number): MockProvider {
  return new MockProvider({ seed, clock: () => FIXED_NOW });
}

describe("Property 9: 策略创建往返一致 (MockProvider.createStrategy)", () => {
  it("Feature: energy-storage-management, Property 9 — 创建成功后可在列表中找到且字段等价", async () => {
    await fc.assert(
      fc.asyncProperty(
        validTradingStrategyInput,
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (input, seed) => {
          // 每个用例使用全新 provider，避免状态在用例间泄漏
          const provider = freshProvider(seed);

          const createResult = await provider.createStrategy(ACCOUNT_ID, input);

          // 合法输入必须创建成功（需求 4.3）
          expect(createResult.ok).toBe(true);
          if (!createResult.ok) return;

          const created = createResult.data;

          // 系统生成的非空 id
          expect(typeof created.id).toBe("string");
          expect(created.id.length).toBeGreaterThan(0);

          // 新建策略归属当前账户（需求 4.3、6.4 / Property 9）
          expect(created.accountId).toBe(ACCOUNT_ID);

          // 新建策略去抖状态为 false（需求 4.10：初始未触发）
          expect(created.triggered).toBe(false);

          // 返回的策略保留输入字段（名称、动作、触发条件、启用状态，需求 4.3-4.5）
          expect(created.name).toBe(input.name);
          expect(created.action).toBe(input.action);
          expect(created.condition.comparator).toBe(input.condition.comparator);
          expect(created.condition.priceThreshold).toBe(input.condition.priceThreshold);
          expect(created.enabled).toBe(input.enabled);

          // 往返一致：该记录必须出现在 listStrategies(accountId) 中（需求 4.3）
          const listResult = await provider.listStrategies(ACCOUNT_ID);
          expect(listResult.ok).toBe(true);
          if (!listResult.ok) return;

          const found = listResult.data.find((s) => s.id === created.id);
          expect(found).toBeDefined();
          if (!found) return;

          // 列表中的记录字段与 input 等价，且归属当前账户
          expect(found.accountId).toBe(ACCOUNT_ID);
          expect(found.name).toBe(input.name);
          expect(found.action).toBe(input.action);
          expect(found.condition.comparator).toBe(input.condition.comparator);
          expect(found.condition.priceThreshold).toBe(input.condition.priceThreshold);
          expect(found.enabled).toBe(input.enabled);
          expect(found.triggered).toBe(false);
        }
      ),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 边界示例（单元测试）：覆盖 4 种 action × 代表性 comparator 与阈值边界
  // ----------------------------------------------------------
  describe("代表性示例", () => {
    it("名称下界 1 + 阈值下界 0 创建并往返一致", async () => {
      const provider = freshProvider(1);
      const input = {
        name: "a",
        action: "charge" as const,
        condition: { comparator: "greater_than" as const, priceThreshold: 0 },
        enabled: true,
      };
      const created = await provider.createStrategy(ACCOUNT_ID, input);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.triggered).toBe(false);

      const list = await provider.listStrategies(ACCOUNT_ID);
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      const found = list.data.find((s) => s.id === created.data.id);
      expect(found).toMatchObject({
        name: "a",
        action: "charge",
        enabled: true,
        condition: { comparator: "greater_than", priceThreshold: 0 },
      });
    });

    it("名称上界 100 + 阈值上界 999999.99 + action=sell 创建并往返一致", async () => {
      const provider = freshProvider(2);
      const input = {
        name: "x".repeat(100),
        action: "sell" as const,
        condition: { comparator: "less_or_equal" as const, priceThreshold: 999999.99 },
        enabled: false,
      };
      const created = await provider.createStrategy(ACCOUNT_ID, input);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const list = await provider.listStrategies(ACCOUNT_ID);
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      const found = list.data.find((s) => s.id === created.data.id);
      expect(found).toMatchObject({
        name: "x".repeat(100),
        action: "sell",
        enabled: false,
        condition: { comparator: "less_or_equal", priceThreshold: 999999.99 },
      });
      expect(found?.triggered).toBe(false);
    });
  });
});
