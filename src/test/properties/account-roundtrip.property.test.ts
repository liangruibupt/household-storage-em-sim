// Feature: energy-storage-management, Property 4: 账户资料更新往返一致且不影响其他账户
//
// 属性来源：design.md「Correctness Properties」Property 4
// Validates: Requirements 2.6
//
// 属性陈述：对任意账户集合与其中任一账户 a、任意通过校验的合法 AccountProfile p，
// 调用 updateAccountProfile(a, p) 成功后，getAccount(a) 返回的资料与 p 等价，
// 且任意其他账户 b ≠ a 的资料保持不变。
//
// 补充覆盖（持久化层面的「原值不变」）：对任意非法更新输入，updateAccountProfile
// 返回 ok=false 且 error.type="VALIDATION"，同时 getAccount(a) 仍返回更新前
// 的原值（内存态不被改动），其他账户亦不受影响。该断言与 Property 5（纯函数校验器层）
// 互补，在 MockProvider 持久化层验证「失败不写入」。
//
// 测试隔离：每个用例使用全新 MockProvider 实例（固定 seed 与固定时钟，默认 2 个账户），
// 避免跨用例的内存态污染，保证确定性可复现。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import {
  invalidAccountProfile,
  validAccountProfile,
} from "@/test/arbitraries/account";

/** 固定 seed 与固定时钟，保证每个 MockProvider 实例的初始数据确定可复现 */
const FIXED_SEED = 0x4011;
const FIXED_NOW = Date.parse("2024-06-15T08:30:00.000Z");

/** 目标账户与「其他账户」标识（默认种子化 2 个账户：account-001、account-002） */
const TARGET_ACCOUNT_ID = "account-001";
const OTHER_ACCOUNT_ID = "account-002";

/** 构造一个隔离的、确定性的 MockProvider 实例（默认 2 个账户） */
function freshProvider(): MockProvider {
  return new MockProvider({
    seed: FIXED_SEED,
    clock: () => FIXED_NOW,
    accountCount: 2,
  });
}

describe("Property 4: 账户资料更新往返一致且不影响其他账户", () => {
  // Feature: energy-storage-management, Property 4: 账户资料更新往返一致且不影响其他账户
  // Validates: Requirements 2.6
  it("合法更新成功后 getAccount(a) 回传与输入等价的资料，且其他账户不变", async () => {
    await fc.assert(
      fc.asyncProperty(validAccountProfile, async (input) => {
        // 每个用例使用全新实例以保证隔离
        const provider = freshProvider();

        // 记录其他账户的更新前资料，用于验证「不受影响」
        const otherBefore = await provider.getAccount(OTHER_ACCOUNT_ID);
        expect(otherBefore.ok).toBe(true);
        if (!otherBefore.ok) return;
        const otherOriginal = otherBefore.data;

        const updateResult = await provider.updateAccountProfile(
          TARGET_ACCOUNT_ID,
          input
        );

        // 合法输入必须更新成功
        expect(updateResult.ok).toBe(true);
        if (!updateResult.ok) return; // 类型收窄

        // 更新返回的资料与输入等价（id 仍为目标账户）
        expect(updateResult.data.id).toBe(TARGET_ACCOUNT_ID);
        expect(updateResult.data.profile).toEqual({
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
        });

        // 往返一致：再次读取目标账户返回与输入等价的资料
        const getResult = await provider.getAccount(TARGET_ACCOUNT_ID);
        expect(getResult.ok).toBe(true);
        if (!getResult.ok) return;
        expect(getResult.data.profile).toEqual({
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
        });

        // 其他账户 b ≠ a 的资料保持不变（Property 4 关键不变量）
        const otherAfter = await provider.getAccount(OTHER_ACCOUNT_ID);
        expect(otherAfter.ok).toBe(true);
        if (!otherAfter.ok) return;
        expect(otherAfter.data).toEqual(otherOriginal);
      }),
      FC_PARAMS
    );
  });

  // Feature: energy-storage-management, Property 4: 账户资料更新往返一致且不影响其他账户
  // Validates: Requirements 2.6
  it("非法更新被拒后存储资料保持不变（失败不写入内存态），其他账户亦不受影响", async () => {
    await fc.assert(
      fc.asyncProperty(invalidAccountProfile, async ({ input }) => {
        const provider = freshProvider();

        // 记录目标账户与其他账户的更新前资料
        const before = await provider.getAccount(TARGET_ACCOUNT_ID);
        expect(before.ok).toBe(true);
        if (!before.ok) return;
        const original = before.data;

        const otherBefore = await provider.getAccount(OTHER_ACCOUNT_ID);
        expect(otherBefore.ok).toBe(true);
        if (!otherBefore.ok) return;
        const otherOriginal = otherBefore.data;

        // 非法更新必须被拒绝且类型为 VALIDATION
        const updateResult = await provider.updateAccountProfile(
          TARGET_ACCOUNT_ID,
          input
        );
        expect(updateResult.ok).toBe(false);
        if (updateResult.ok) return;
        expect(updateResult.error.type).toBe("VALIDATION");

        // 原值不变：再次读取仍为更新前的资料
        const after = await provider.getAccount(TARGET_ACCOUNT_ID);
        expect(after.ok).toBe(true);
        if (!after.ok) return;
        expect(after.data).toEqual(original);

        // 其他账户同样不受影响
        const otherAfter = await provider.getAccount(OTHER_ACCOUNT_ID);
        expect(otherAfter.ok).toBe(true);
        if (!otherAfter.ok) return;
        expect(otherAfter.data).toEqual(otherOriginal);
      }),
      FC_PARAMS
    );
  });
});
