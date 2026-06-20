// Feature: energy-storage-management, Property 10: 策略创建校验拒绝非法输入
//
// 本文件实现设计文档中的 Property 10：对任意非法策略创建输入（缺少触发条件、动作或名称；
// 名称长度 ∉ [1,100]；action 不属于 4 种枚举；comparator 不属于 5 种枚举；
// 电价阈值 ∉ [0, 999999.99]），校验都返回 ok=false 且 error.type="VALIDATION"
// 并指明缺失/不合法字段，同时不会持久化（即不向策略集合增加记录）。
//
// 说明：Property 10 在设计中被映射到 `validation + createStrategy`。本任务（3.3）位于
// MockProvider（task 10.8 的 createStrategy）实现之前，因此此处直接对纯函数校验器
// `validateTradingStrategyInput` 进行属性测试——它是 createStrategy 写入内存前的唯一校验门。
// 校验器为纯函数、无任何外部状态，因此「不持久化」不变量天然成立（无副作用）。
//
// Validates: Requirements 4.8, 4.9

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { validateTradingStrategyInput } from "@/lib/data-access/validation";
import type {
  PriceComparator,
  StrategyAction,
  TradingStrategyInput,
} from "@/lib/data-access/types";

// ============================================================
// 合法取值生成器（用于构造「除单一非法字段外其余均合法」的输入）
// ============================================================

/** 合法策略动作枚举（需求 4.4） */
const VALID_ACTIONS: readonly StrategyAction[] = [
  "charge",
  "discharge",
  "buy",
  "sell",
];

/** 合法电价比较关系枚举（需求 4.5） */
const VALID_COMPARATORS: readonly PriceComparator[] = [
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal",
];

/** 受控 ASCII 字符集：保证生成字符串的 .length（UTF-16 码元）与字符数一致，避免边界抖动 */
const ASCII_CHAR = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -".split(
    ""
  )
);

/** 合法名称：长度 ∈ [1, 100] */
const validName = fc
  .array(ASCII_CHAR, { minLength: 1, maxLength: 100 })
  .map((chars) => chars.join(""));

const validAction = fc.constantFrom(...VALID_ACTIONS);
const validComparator = fc.constantFrom(...VALID_COMPARATORS);

/** 合法电价阈值：∈ [0, 999999.99] 的有限数值 */
const validThreshold = fc.double({ min: 0, max: 999999.99, noNaN: true });

// ============================================================
// 非法取值生成器
// ============================================================

/** 非法名称：长度为 0、长度 > 100，或缺失（非字符串） */
const invalidName = fc.oneof(
  fc.constant(""), // 长度 0（边界：0）
  fc
    .array(ASCII_CHAR, { minLength: 101, maxLength: 160 })
    .map((chars) => chars.join("")), // 长度 > 100（边界：101+）
  fc.constant(undefined), // 缺失字段
  fc.constant(null)
);

/** 非法动作：不属于 4 种枚举的字符串，或缺失 */
const invalidAction = fc.oneof(
  fc.constantFrom("trade", "CHARGE", "sel", "", "hold", "discharging"),
  fc
    .string()
    .filter(
      (s) => !VALID_ACTIONS.includes(s as StrategyAction)
    ),
  fc.constant(undefined),
  fc.constant(null)
);

/** 非法比较关系：不属于 5 种枚举的字符串，或缺失 */
const invalidComparator = fc.oneof(
  fc.constantFrom("gt", "ge", "lt", "le", "eq", "GREATER_THAN", "", "between"),
  fc
    .string()
    .filter((s) => !VALID_COMPARATORS.includes(s as PriceComparator)),
  fc.constant(undefined),
  fc.constant(null)
);

/** 非法阈值：< 0、> 999999.99，或非有限数值（NaN/Infinity）、或缺失 */
const invalidThreshold = fc.oneof(
  fc.double({ min: -1_000_000, max: -0.01, noNaN: true }), // 小于下界
  fc.double({ min: 1_000_000, max: 1_000_000_000, noNaN: true }), // 大于上界
  fc.constantFrom(NaN, Infinity, -Infinity), // 非有限
  fc.constant(undefined),
  fc.constant(null)
);

// ============================================================
// 组合非法输入生成器：每个 case 仅破坏单一字段，其余字段保持合法，
// 以便对「首个出错字段」做确定性断言。
// 校验顺序：name → action → condition → comparator → priceThreshold。
// ============================================================

interface IllegalCase {
  /** 待校验输入（故意构造为非法，使用 any 以绕过编译期类型约束） */
  input: TradingStrategyInput;
  /** 期望的首个出错字段 */
  expectedField: string;
}

/** 名称非法 → 期望 field="name" */
const caseInvalidName = fc
  .record({
    name: invalidName,
    action: validAction,
    comparator: validComparator,
    priceThreshold: validThreshold,
  })
  .map(({ name, action, comparator, priceThreshold }) => ({
    input: { name, action, condition: { comparator, priceThreshold } } as unknown as TradingStrategyInput,
    expectedField: "name",
  }));

/** 动作非法 → 期望 field="action" */
const caseInvalidAction = fc
  .record({
    name: validName,
    action: invalidAction,
    comparator: validComparator,
    priceThreshold: validThreshold,
  })
  .map(({ name, action, comparator, priceThreshold }) => ({
    input: { name, action, condition: { comparator, priceThreshold } } as unknown as TradingStrategyInput,
    expectedField: "action",
  }));

/** 触发条件缺失 → 期望 field="condition" */
const caseMissingCondition = fc
  .record({
    name: validName,
    action: validAction,
    condition: fc.constantFrom(undefined, null),
  })
  .map(({ name, action, condition }) => ({
    input: { name, action, condition } as unknown as TradingStrategyInput,
    expectedField: "condition",
  }));

/** 比较关系非法 → 期望 field="comparator" */
const caseInvalidComparator = fc
  .record({
    name: validName,
    action: validAction,
    comparator: invalidComparator,
    priceThreshold: validThreshold,
  })
  .map(({ name, action, comparator, priceThreshold }) => ({
    input: { name, action, condition: { comparator, priceThreshold } } as unknown as TradingStrategyInput,
    expectedField: "comparator",
  }));

/** 电价阈值越界/非法 → 期望 field="priceThreshold" */
const caseInvalidThreshold = fc
  .record({
    name: validName,
    action: validAction,
    comparator: validComparator,
    priceThreshold: invalidThreshold,
  })
  .map(({ name, action, comparator, priceThreshold }) => ({
    input: { name, action, condition: { comparator, priceThreshold } } as unknown as TradingStrategyInput,
    expectedField: "priceThreshold",
  }));

/** 任意非法策略输入生成器（覆盖全部非法分支） */
const illegalStrategyInput: fc.Arbitrary<IllegalCase> = fc.oneof(
  caseInvalidName,
  caseInvalidAction,
  caseMissingCondition,
  caseInvalidComparator,
  caseInvalidThreshold
);

// ============================================================
// 属性测试
// ============================================================

describe("Property 10: 策略创建校验拒绝非法输入 (validateTradingStrategyInput)", () => {
  it("Feature: energy-storage-management, Property 10 — 任意非法输入均被拒绝且指明出错字段", () => {
    fc.assert(
      fc.property(illegalStrategyInput, ({ input, expectedField }) => {
        const result = validateTradingStrategyInput(input);

        // 必须拒绝
        expect(result.ok).toBe(false);
        if (result.ok) return; // 类型收窄（前一行已断言失败）

        // 错误类型恒为 VALIDATION
        expect(result.error.type).toBe("VALIDATION");
        // 指明首个出错字段
        expect(result.error.field).toBe(expectedField);
        // 不携带任何业务数据（纯函数校验器无副作用，天然不持久化）
        expect("data" in result).toBe(false);
      }),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 边界示例（单元测试）：名称长度 0 / 1 / 100 / 101
  // ----------------------------------------------------------
  describe("名称长度边界示例", () => {
    const baseValidRest = {
      action: "charge" as StrategyAction,
      condition: {
        comparator: "greater_than" as PriceComparator,
        priceThreshold: 1.5,
      },
    };

    it("名称长度 0 被拒绝（field=name）", () => {
      // 故意省略 enabled 的不完整输入，断言为 TradingStrategyInput 以通过类型检查
      const result = validateTradingStrategyInput({
        name: "",
        ...baseValidRest,
      } as TradingStrategyInput);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION");
        expect(result.error.field).toBe("name");
      }
    });

    it("名称长度 1 被接受（下界）", () => {
      const result = validateTradingStrategyInput({
        name: "a",
        ...baseValidRest,
      } as TradingStrategyInput);
      expect(result.ok).toBe(true);
    });

    it("名称长度 100 被接受（上界）", () => {
      const result = validateTradingStrategyInput({
        name: "a".repeat(100),
        ...baseValidRest,
      } as TradingStrategyInput);
      expect(result.ok).toBe(true);
    });

    it("名称长度 101 被拒绝（field=name）", () => {
      const result = validateTradingStrategyInput({
        name: "a".repeat(101),
        ...baseValidRest,
      } as TradingStrategyInput);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("VALIDATION");
        expect(result.error.field).toBe("name");
      }
    });
  });

  // ----------------------------------------------------------
  // 边界示例（单元测试）：电价阈值 0 / 999999.99（合法边界）与越界
  // ----------------------------------------------------------
  describe("电价阈值边界示例", () => {
    const validRest = {
      name: "策略A",
      action: "buy" as StrategyAction,
    };

    it("阈值 0 被接受（下界）", () => {
      // 故意省略 enabled 的不完整输入，断言为 TradingStrategyInput 以通过类型检查
      const result = validateTradingStrategyInput({
        ...validRest,
        condition: { comparator: "less_than", priceThreshold: 0 },
      } as TradingStrategyInput);
      expect(result.ok).toBe(true);
    });

    it("阈值 999999.99 被接受（上界）", () => {
      const result = validateTradingStrategyInput({
        ...validRest,
        condition: { comparator: "less_than", priceThreshold: 999999.99 },
      } as TradingStrategyInput);
      expect(result.ok).toBe(true);
    });

    it("阈值 -0.01 被拒绝（field=priceThreshold）", () => {
      const result = validateTradingStrategyInput({
        ...validRest,
        condition: { comparator: "less_than", priceThreshold: -0.01 },
      } as TradingStrategyInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe("priceThreshold");
    });

    it("阈值 1000000 被拒绝（field=priceThreshold）", () => {
      const result = validateTradingStrategyInput({
        ...validRest,
        condition: { comparator: "less_than", priceThreshold: 1_000_000 },
      } as TradingStrategyInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe("priceThreshold");
    });
  });
});
