// 电力交易策略输入的 fast-check 生成器（Arbitrary）
//
// 本模块提供「合法」TradingStrategyInput 的生成器，供策略创建相关属性测试使用
// （如 Property 9：策略创建往返一致）。
//
// 设计要点：
// - 严格落在校验器 validateTradingStrategyInput 的合法值域内：
//   名称长度 ∈ [1, 100]、action ∈ 4 种枚举、comparator ∈ 5 种枚举、
//   电价阈值 ∈ [0, 999999.99]、enabled 为布尔值（需求 4.4、4.5、4.8、4.9）。
// - 使用受控 ASCII 字符集，保证生成字符串的 .length（UTF-16 码元）与字符数一致，
//   避免在长度边界（1/100）处因多码元字符产生抖动。
//
// 对应需求：4.3、4.4、4.5（Property 9）

import fc from "fast-check";
import type {
  PriceComparator,
  StrategyAction,
  TradingStrategyInput,
} from "@/lib/data-access/types";

/** 合法策略动作枚举（需求 4.4） */
export const VALID_ACTIONS: readonly StrategyAction[] = [
  "charge",
  "discharge",
  "buy",
  "sell",
];

/** 合法电价比较关系枚举（需求 4.5） */
export const VALID_COMPARATORS: readonly PriceComparator[] = [
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal",
];

/** 受控 ASCII 字符集：保证 .length 与字符数一致 */
const ASCII_CHAR = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -".split("")
);

/** 合法名称：长度 ∈ [1, 100]，偏重覆盖下界 1 与上界 100 */
export const validStrategyName: fc.Arbitrary<string> = fc.oneof(
  fc.constant("a"), // 下界 1
  fc.constant("a".repeat(100)), // 上界 100
  fc.array(ASCII_CHAR, { minLength: 1, maxLength: 100 }).map((chars) => chars.join(""))
);

/** 合法动作 */
export const validStrategyAction: fc.Arbitrary<StrategyAction> = fc.constantFrom(
  ...VALID_ACTIONS
);

/** 合法比较关系 */
export const validPriceComparator: fc.Arbitrary<PriceComparator> = fc.constantFrom(
  ...VALID_COMPARATORS
);

/** 合法电价阈值：∈ [0, 999999.99] 的有限数值，偏重覆盖边界 0 与 999999.99 */
export const validPriceThreshold: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0), // 下界
  fc.constant(999999.99), // 上界
  fc.double({ min: 0, max: 999999.99, noNaN: true })
);

/**
 * 合法 TradingStrategyInput 生成器：所有字段均落在校验器合法值域内。
 * 形如 { name, action, condition: { comparator, priceThreshold }, enabled }。
 */
export const validTradingStrategyInput: fc.Arbitrary<TradingStrategyInput> = fc.record({
  name: validStrategyName,
  action: validStrategyAction,
  condition: fc.record({
    comparator: validPriceComparator,
    priceThreshold: validPriceThreshold,
  }),
  enabled: fc.boolean(),
});
