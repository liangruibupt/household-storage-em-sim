// Feature: energy-storage-management, Property 17: 账户数量上限 5 创建被拒
//
// 属性来源：design.md「Correctness Properties」Property 17
// Validates: Requirements 2.5, 6.4
//
// 属性陈述：对任意已含 5 个账户的账户集合与任意账户创建输入，createAccount 都返回
// ok=false 且 error.type="ACCOUNT_LIMIT"，账户集合长度保持为 5、不新增任何账户。
//
// 被测对象：MockProvider.createAccount（账户数 = MAX_ACCOUNTS = 5）。
// 每个用例使用全新 MockProvider 实例（固定时钟，accountCount: 5），保证确定性与隔离。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { MAX_ACCOUNTS } from "@/lib/data-access/mock/seed-data";
import { validAccountProfile } from "@/test/arbitraries/account";

// 固定时钟基准（epoch 毫秒），保证种子数据确定可复现。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

/** 构造一个恰好含 5 个账户（已达上限）的全新 MockProvider。 */
function providerAtLimit(seed: number): MockProvider {
  return new MockProvider({
    seed,
    clock: () => FIXED_NOW,
    accountCount: MAX_ACCOUNTS,
  });
}

describe("Property 17: 账户数量上限 5 创建被拒", () => {
  it("Feature: energy-storage-management, Property 17 — 账户数已达 5 时任意创建输入被拒且不新增", async () => {
    await fc.assert(
      fc.asyncProperty(
        validAccountProfile,
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (input, seed) => {
          const provider = providerAtLimit(seed);

          // 前置确认：初始恰好 5 个账户
          const before = await provider.listAccounts();
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          expect(before.data.length).toBe(MAX_ACCOUNTS);

          // 即便输入合法，达上限时创建也必须被拒（需求 2.5、6.4）
          const result = await provider.createAccount(input);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.type).toBe("ACCOUNT_LIMIT");
          // 失败结果不携带任何业务数据
          expect("data" in result).toBe(false);

          // 账户集合长度保持为 5、不新增任何账户
          const after = await provider.listAccounts();
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.data.length).toBe(MAX_ACCOUNTS);
          // 账户 id 集合不变
          expect(after.data.map((a) => a.id).sort()).toEqual(
            before.data.map((a) => a.id).sort()
          );
        }
      ),
      FC_PARAMS
    );
  });

  it("MAX_ACCOUNTS 常量等于 5（注册上限）", () => {
    expect(MAX_ACCOUNTS).toBe(5);
  });
});
