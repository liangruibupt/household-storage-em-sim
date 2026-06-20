// Feature: energy-storage-management, Property 4: 账户资料更新往返一致
//
// 属性来源：design.md「Correctness Properties」Property 4
// Validates: Requirements 2.2
//
// 属性陈述：对任意通过校验的合法 AccountProfile，调用 updateAccountProfile(p)
// 成功后，再调用 getAccountProfile() 返回的资料与 p 等价。
//
// 补充覆盖（持久化层面的「原值不变」）：对任意非法更新输入，updateAccountProfile
// 返回 ok=false 且 error.type="VALIDATION"，同时 getAccountProfile() 仍返回更新前
// 的原值（内存态不被改动）。该断言与 Property 5（纯函数校验器层）互补，
// 在 MockProvider 持久化层验证「失败不写入」。
//
// 测试隔离：每个用例使用全新 MockProvider 实例（固定 seed 与固定时钟），
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

/** 构造一个隔离的、确定性的 MockProvider 实例 */
function freshProvider(): MockProvider {
  return new MockProvider({ seed: FIXED_SEED, clock: () => FIXED_NOW });
}

describe("Property 4: 账户资料更新往返一致", () => {
  // Feature: energy-storage-management, Property 4: 账户资料更新往返一致
  // Validates: Requirements 2.2
  it("合法更新成功后 getAccountProfile() 回传与输入等价的资料", async () => {
    await fc.assert(
      fc.asyncProperty(validAccountProfile, async (input) => {
        // 每个用例使用全新实例以保证隔离
        const provider = freshProvider();

        const updateResult = await provider.updateAccountProfile(input);

        // 合法输入必须更新成功
        expect(updateResult.ok).toBe(true);
        if (!updateResult.ok) return; // 类型收窄

        // 更新返回的资料与输入等价
        expect(updateResult.data).toEqual({
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
        });

        // 往返一致：再次读取返回与输入等价的资料
        const getResult = await provider.getAccountProfile();
        expect(getResult.ok).toBe(true);
        if (!getResult.ok) return;

        expect(getResult.data).toEqual({
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
        });
      }),
      FC_PARAMS
    );
  });

  // Feature: energy-storage-management, Property 4: 账户资料更新往返一致
  // Validates: Requirements 2.2
  it("非法更新被拒后存储资料保持不变（失败不写入内存态）", async () => {
    await fc.assert(
      fc.asyncProperty(invalidAccountProfile, async ({ input }) => {
        const provider = freshProvider();

        // 记录更新前的原值
        const before = await provider.getAccountProfile();
        expect(before.ok).toBe(true);
        if (!before.ok) return;
        const original = { ...before.data };

        // 非法更新必须被拒绝且类型为 VALIDATION
        const updateResult = await provider.updateAccountProfile(input);
        expect(updateResult.ok).toBe(false);
        if (updateResult.ok) return;
        expect(updateResult.error.type).toBe("VALIDATION");

        // 原值不变：再次读取仍为更新前的资料
        const after = await provider.getAccountProfile();
        expect(after.ok).toBe(true);
        if (!after.ok) return;
        expect(after.data).toEqual(original);
      }),
      FC_PARAMS
    );
  });
});
