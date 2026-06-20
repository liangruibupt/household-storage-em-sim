// Feature: energy-storage-management, Property 5: 非法账户字段被拒且原值不变
//
// 属性来源：design.md「Correctness Properties」Property 5
// Validates: Requirements 2.3, 2.4, 2.5
//
// 属性陈述：对任意含非法字段的账户输入（邮箱缺少 "@" 或长度 >254；姓名为空或
// 长度 ∉ [1,50]；电话长度 ∉ [5,20] 或含 [0-9 + - 空格] 之外字符；地址长度 >200），
// 校验都应返回 ok=false 且 error.type="VALIDATION" 并指明对应 field，
// 同时不产生/返回任何业务数据，且不修改原输入（原值不变）。
//
// 说明：本任务针对纯函数校验器 validation.ts。「原值不变」在该层体现为
// 校验器为纯函数——拒绝时不返回 data、不改动入参对象。MockProvider 中
// updateAccountProfile 的持久化「原值不变」由 Property 4（任务 10.4）覆盖。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { validateAccountProfile } from "@/lib/data-access/validation";
import { invalidAccountProfile, validAccountProfile } from "@/test/arbitraries/account";

describe("Property 5: 非法账户字段被拒且原值不变", () => {
  // Feature: energy-storage-management, Property 5: 非法账户字段被拒且原值不变
  // Validates: Requirements 2.3, 2.4, 2.5
  it("拒绝任意非法账户输入：ok=false、type=VALIDATION、field 精确匹配，且入参不被修改", () => {
    fc.assert(
      fc.property(invalidAccountProfile, ({ input, expectedField }) => {
        // 记录入参快照，用于验证「原值不变」（校验器不得修改入参）
        const snapshot = JSON.stringify(input);

        const result = validateAccountProfile(input);

        // 1) 必须被拒绝
        expect(result.ok).toBe(false);
        if (result.ok) return; // 类型收窄，理论上不会进入

        // 2) 错误类型为 VALIDATION
        expect(result.error.type).toBe("VALIDATION");

        // 3) 指明对应出错字段
        expect(result.error.field).toBe(expectedField);

        // 4) 不返回任何业务数据
        expect("data" in result).toBe(false);

        // 5) 原值不变：校验器为纯函数，入参对象不被修改
        expect(JSON.stringify(input)).toBe(snapshot);
      }),
      FC_PARAMS
    );
  });

  // 配套正向用例：确认合法输入被接受（保证非法生成器并非「永真」而失真）。
  // Validates: Requirements 2.3, 2.4, 2.5
  it("接受任意合法账户输入：ok=true 且回传等价资料", () => {
    fc.assert(
      fc.property(validAccountProfile, (input) => {
        const result = validateAccountProfile(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data).toEqual({
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
        });
      }),
      FC_PARAMS
    );
  });
});
