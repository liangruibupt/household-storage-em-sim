// 策略触发去抖逻辑（需求 4.10）
// 本文件提供纯函数 evaluateTrigger，依据策略当前去抖状态、触发条件与当前电价，
// 计算本次是否应记录动作以及更新后的去抖状态。
//
// 去抖语义：
//   - 条件满足且此前未触发  -> 记录一次动作，triggered=true；
//   - 条件持续满足且已触发  -> 不重复记录，triggered 保持 true；
//   - 条件不再满足          -> triggered=false（重置，允许下次再次记录）。
//
// 该函数为不抛异常的纯函数，便于属性测试。

import type { PriceComparator, TriggerCondition } from "../data-access/types";

/** evaluateTrigger 的返回结构 */
export interface TriggerEvaluation {
  /** 本次是否应记录一次对应动作 */
  shouldRecord: boolean;
  /** 计算后的新去抖状态（是否处于"已触发未重置"状态） */
  nextTriggered: boolean;
}

/**
 * 判断当前电价是否满足给定比较关系下的电价阈值条件。
 * 支持全部 5 种 PriceComparator 取值（需求 4.5）。
 *
 * @param comparator 比较关系
 * @param currentPrice 当前电价
 * @param threshold 电价阈值
 * @returns 条件是否满足
 */
export function isConditionSatisfied(
  comparator: PriceComparator,
  currentPrice: number,
  threshold: number
): boolean {
  // 对 5 种比较关系逐一处理；使用穷尽的 switch 保证类型安全
  switch (comparator) {
    case "greater_than":
      return currentPrice > threshold;
    case "greater_or_equal":
      return currentPrice >= threshold;
    case "less_than":
      return currentPrice < threshold;
    case "less_or_equal":
      return currentPrice <= threshold;
    case "equal":
      return currentPrice === threshold;
    default: {
      // 穷尽性检查：若未来新增枚举值且未处理，编译期即报错；
      // never 类型可安全赋给 boolean 返回值，运行期兜底为不满足，保持纯函数不抛异常
      const _exhaustive: never = comparator;
      return _exhaustive;
    }
  }
}

/**
 * 依据去抖语义计算本次评估结果。
 *
 * 规则（需求 4.10）：
 *   - 条件满足且此前未触发（prevTriggered=false）-> 记录一次，nextTriggered=true；
 *   - 条件满足且此前已触发（prevTriggered=true） -> 不重复记录，nextTriggered=true；
 *   - 条件不满足                                  -> 不记录，nextTriggered=false（重置）。
 *
 * @param prevTriggered 策略当前的去抖状态（上一次评估后是否处于已触发未重置状态）
 * @param condition 触发条件（比较关系 + 电价阈值）
 * @param currentPrice 当前电价
 * @returns 是否应记录动作及更新后的去抖状态
 */
export function evaluateTrigger(
  prevTriggered: boolean,
  condition: TriggerCondition,
  currentPrice: number
): TriggerEvaluation {
  // 判断当前电价是否满足触发条件
  const satisfied = isConditionSatisfied(
    condition.comparator,
    currentPrice,
    condition.priceThreshold
  );

  // 条件不再满足：重置去抖状态，且不记录动作
  if (!satisfied) {
    return { shouldRecord: false, nextTriggered: false };
  }

  // 条件满足：仅当此前未触发时记录一次，随后置为已触发
  const shouldRecord = !prevTriggered;
  return { shouldRecord, nextTriggered: true };
}
