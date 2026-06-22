// Feature: energy-storage-management, Property 18: 至少保留 1 个账户
//
// 属性来源：design.md「Correctness Properties」Property 18
// Validates: Requirements 2.12
//
// 属性陈述：对任意仅含 1 个账户的账户集合，对该唯一账户调用 deleteAccount 都返回
// ok=false 且 error.type="LAST_ACCOUNT"，该账户保持存在、账户集合长度仍为 1。
//
// 被测对象：MockProvider.deleteAccount（账户数 = 1）。
// 每个用例使用全新 MockProvider 实例（固定时钟，accountCount: 1），保证确定性与隔离。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";

// 固定时钟基准（epoch 毫秒），保证种子数据确定可复现。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

/** 构造一个仅含 1 个账户的全新 MockProvider。 */
function singleAccountProvider(seed: number): MockProvider {
  return new MockProvider({
    seed,
    clock: () => FIXED_NOW,
    accountCount: 1,
  });
}

describe("Property 18: 至少保留 1 个账户", () => {
  it("Feature: energy-storage-management, Property 18 — 删除唯一账户被拒且账户仍存在", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (seed) => {
          const provider = singleAccountProvider(seed);

          // 取唯一账户
          const before = await provider.listAccounts();
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          expect(before.data.length).toBe(1);
          const onlyId = before.data[0].id;

          // 删除唯一账户必须被拒（需求 2.12）
          const result = await provider.deleteAccount(onlyId);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.type).toBe("LAST_ACCOUNT");
          // 失败结果不携带任何业务数据
          expect("data" in result).toBe(false);

          // 该账户保持存在、集合长度仍为 1
          const after = await provider.listAccounts();
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.data.length).toBe(1);
          expect(after.data[0].id).toBe(onlyId);

          // 仍可读取该账户（确认未被删除）
          const get = await provider.getAccount(onlyId);
          expect(get.ok).toBe(true);
        }
      ),
      FC_PARAMS
    );
  });
});
