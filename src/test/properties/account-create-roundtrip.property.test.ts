// Feature: energy-storage-management, Property 19: 账户创建往返一致
//
// 属性来源：design.md「Correctness Properties」Property 19
// Validates: Requirements 2.4
//
// 属性陈述：对任意含少于 5 个账户的账户集合与任意通过校验的合法 AccountProfileInput p，
// createAccount(p) 成功后：账户集合长度恰好增加 1；新账户拥有在集合内唯一的 id；
// getAccount(newId) 返回的 profile 与 p 等价。
//
// 被测对象：MockProvider.createAccount + getAccount + listAccounts。
// 每个用例使用全新 MockProvider 实例（固定时钟，初始账户数 1..4），保证确定性与隔离。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { validAccountProfile } from "@/test/arbitraries/account";

// 固定时钟基准（epoch 毫秒），保证种子数据确定可复现。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

describe("Property 19: 账户创建往返一致", () => {
  it("Feature: energy-storage-management, Property 19 — 创建成功后长度 +1、id 唯一、getAccount 往返一致", async () => {
    await fc.assert(
      fc.asyncProperty(
        validAccountProfile,
        // 初始账户数 1..4（均小于上限 5，保证创建可成功）
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (input, initialCount, seed) => {
          const provider = new MockProvider({
            seed,
            clock: () => FIXED_NOW,
            accountCount: initialCount,
          });

          const before = await provider.listAccounts();
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          const beforeIds = before.data.map((a) => a.id);
          expect(beforeIds.length).toBe(initialCount);

          // 合法输入且未达上限：创建必须成功（需求 2.4）
          const createResult = await provider.createAccount(input);
          expect(createResult.ok).toBe(true);
          if (!createResult.ok) return;
          const newAccount = createResult.data;

          // 返回的新账户资料与输入等价
          expect(newAccount.profile).toEqual({
            name: input.name,
            email: input.email,
            phone: input.phone,
            address: input.address,
          });

          // 新账户 id 在集合内唯一（不与已有 id 冲突）
          expect(beforeIds).not.toContain(newAccount.id);

          // 账户集合长度恰好增加 1
          const after = await provider.listAccounts();
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.data.length).toBe(initialCount + 1);
          // 整体 id 集合仍唯一
          const afterIds = after.data.map((a) => a.id);
          expect(new Set(afterIds).size).toBe(afterIds.length);
          expect(afterIds).toContain(newAccount.id);

          // 往返一致：getAccount(newId) 返回的 profile 与 p 等价
          const get = await provider.getAccount(newAccount.id);
          expect(get.ok).toBe(true);
          if (!get.ok) return;
          expect(get.data.id).toBe(newAccount.id);
          expect(get.data.profile).toEqual({
            name: input.name,
            email: input.email,
            phone: input.phone,
            address: input.address,
          });
        }
      ),
      FC_PARAMS
    );
  });
});
