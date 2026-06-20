// 电力交易功能区共享标签与选项（中文 UI）
//
// 将策略动作、电价比较关系的「枚举值 → 中文显示文本」集中在此，
// 供 StrategyList、StrategyForm、ActionHistory 等组件复用，保持单一事实来源。
// 对应需求：4.4（4 种动作）、4.5（5 种比较关系）。

import type { PriceComparator, StrategyAction } from "@/lib/data-access/types";

/** 策略动作（charge/discharge/buy/sell）→ 中文显示文本（需求 4.4） */
export const ACTION_LABELS: Record<StrategyAction, string> = {
  charge: "充电",
  discharge: "放电",
  buy: "买电",
  sell: "卖电",
};

/** 电价比较关系（5 种）→ 中文显示文本（需求 4.5） */
export const COMPARATOR_LABELS: Record<PriceComparator, string> = {
  greater_than: "大于",
  greater_or_equal: "大于等于",
  less_than: "小于",
  less_or_equal: "小于等于",
  equal: "等于",
};

/** 动作下拉选项（顺序固定，恰好 4 项，需求 4.4） */
export const ACTION_OPTIONS: readonly StrategyAction[] = [
  "charge",
  "discharge",
  "buy",
  "sell",
];

/** 比较关系下拉选项（顺序固定，恰好 5 项，需求 4.5） */
export const COMPARATOR_OPTIONS: readonly PriceComparator[] = [
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal",
];

/**
 * 将动作枚举值格式化为中文显示文本（未知值原样返回，做防御性兜底）。
 */
export function formatAction(action: StrategyAction): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * 将比较关系枚举值格式化为中文显示文本（未知值原样返回，做防御性兜底）。
 */
export function formatComparator(comparator: PriceComparator): string {
  return COMPARATOR_LABELS[comparator] ?? comparator;
}
