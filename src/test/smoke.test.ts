import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS, NUM_RUNS } from "./fc-config";

// 冒烟测试：验证测试运行器（Vitest）与属性测试库（fast-check）配置可用。
describe("test infrastructure smoke", () => {
  it("runs the test runner", () => {
    expect(true).toBe(true);
  });

  it("resolves the @/ path alias", async () => {
    // 通过别名导入，验证 @/ 解析与 tsconfig 一致
    const mod = await import("@/test/fc-config");
    expect(mod.NUM_RUNS).toBe(100);
  });

  it("runs fast-check property tests with the shared config", () => {
    // 简单的全称属性：加法交换律，作为属性测试链路的冒烟验证
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { ...FC_PARAMS, numRuns: NUM_RUNS }
    );
  });
});
