// Feature: energy-storage-management, Property 11: 策略启用状态更新往返一致
//
// 本文件实现设计文档中的 Property 11：对任意已存在的策略与任意布尔值 e，
// 调用 updateStrategy(id, { enabled: e }) 成功后，
//   - 返回的策略 enabled 等于 e；
//   - listStrategies() 中对应记录的 enabled 也等于 e；
//   - 反复 enable/disable 切换时，最终读取始终反映最后一次设置的值（持久化）。
//
// 被测对象：MockProvider.updateStrategy + listStrategies（task 10.8）。
// 每个用例使用全新的 MockProvider 实例并注入固定时钟，保证确定性与隔离。
//
// Validates: Requirements 4.6

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

/** 读取列表中指定 id 策略的 enabled 值；不存在返回 undefined。 */
async function readEnabled(
  provider: MockProvider,
  id: string
): Promise<boolean | undefined> {
  const list = await provider.listStrategies(ACCOUNT_ID);
  if (!list.ok) return undefined;
  return list.data.find((s) => s.id === id)?.enabled;
}

describe("Property 11: 策略启用状态更新往返一致 (MockProvider.updateStrategy)", () => {
  it("Feature: energy-storage-management, Property 11 — 更新 enabled 后返回值与列表均反映新值", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 先创建一条合法策略，保证目标策略一定存在（不依赖种子策略的具体状态）
        validTradingStrategyInput,
        fc.boolean(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (input, targetEnabled, seed) => {
          const provider = freshProvider(seed);

          // 创建目标策略
          const created = await provider.createStrategy(ACCOUNT_ID, input);
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          const id = created.data.id;

          // 仅更新 enabled 字段（需求 4.6）
          const updated = await provider.updateStrategy(ACCOUNT_ID, id, {
            enabled: targetEnabled,
          });

          // 已存在策略的合法 enabled 更新必须成功
          expect(updated.ok).toBe(true);
          if (!updated.ok) return;

          // 返回的策略反映新的 enabled 值
          expect(updated.data.id).toBe(id);
          expect(updated.data.enabled).toBe(targetEnabled);

          // 往返一致：列表读取也反映新的 enabled 值
          const listedEnabled = await readEnabled(provider, id);
          expect(listedEnabled).toBe(targetEnabled);

          // 其它字段不受 enabled 更新影响（保持原值）
          expect(updated.data.name).toBe(input.name);
          expect(updated.data.action).toBe(input.action);
          expect(updated.data.condition.comparator).toBe(input.condition.comparator);
          expect(updated.data.condition.priceThreshold).toBe(
            input.condition.priceThreshold
          );
        }
      ),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 11 — 反复切换 enable/disable 持久化为最后一次设置", async () => {
    await fc.assert(
      fc.asyncProperty(
        validTradingStrategyInput,
        // 一串布尔切换序列（长度 1-10），逐次应用并校验持久化
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (input, toggles, seed) => {
          const provider = freshProvider(seed);

          const created = await provider.createStrategy(ACCOUNT_ID, input);
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          const id = created.data.id;

          // 逐次应用切换，每一步都校验返回值与列表均反映当前设置值
          for (const next of toggles) {
            const res = await provider.updateStrategy(ACCOUNT_ID, id, { enabled: next });
            expect(res.ok).toBe(true);
            if (!res.ok) return;
            expect(res.data.enabled).toBe(next);

            const listedEnabled = await readEnabled(provider, id);
            expect(listedEnabled).toBe(next);
          }

          // 最终读取等于序列最后一次设置的值（持久化）
          const finalExpected = toggles[toggles.length - 1];
          const finalEnabled = await readEnabled(provider, id);
          expect(finalEnabled).toBe(finalExpected);
        }
      ),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 11 — 对种子策略切换 enabled 同样往返一致", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (targetEnabled, seed) => {
          const provider = freshProvider(seed);

          // 使用默认种子策略（DEFAULT_STRATEGY_COUNT=4，列表非空）
          const list = await provider.listStrategies(ACCOUNT_ID);
          expect(list.ok).toBe(true);
          if (!list.ok) return;
          expect(list.data.length).toBeGreaterThan(0);

          const target = list.data[0];

          const updated = await provider.updateStrategy(ACCOUNT_ID, target.id, {
            enabled: targetEnabled,
          });
          expect(updated.ok).toBe(true);
          if (!updated.ok) return;
          expect(updated.data.enabled).toBe(targetEnabled);

          const listedEnabled = await readEnabled(provider, target.id);
          expect(listedEnabled).toBe(targetEnabled);
        }
      ),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 代表性示例（单元测试）：显式覆盖 true→false→true 切换轨迹
  // ----------------------------------------------------------
  describe("代表性示例", () => {
    it("enable→disable→enable 轨迹的每一步均持久化", async () => {
      const provider = freshProvider(7);
      const created = await provider.createStrategy(ACCOUNT_ID, {
        name: "toggle-demo",
        action: "charge",
        condition: { comparator: "greater_than", priceThreshold: 1.5 },
        enabled: false,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      for (const next of [true, false, true]) {
        const res = await provider.updateStrategy(ACCOUNT_ID, id, { enabled: next });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.enabled).toBe(next);
        expect(await readEnabled(provider, id)).toBe(next);
      }
    });
  });
});
