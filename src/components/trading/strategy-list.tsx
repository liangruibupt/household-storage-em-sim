"use client";

// 策略列表组件 StrategyList（需求 4.1、4.2、4.6、4.7）
//
// 设计要点（设计文档「智能电力交易」一节）：
//   - 展示全部策略及其启用状态（需求 4.1）。
//   - 无策略时显示「暂无策略」空状态（需求 4.2）；空列表为正常状态，不显示错误。
//   - 每条策略提供启停切换（StrategyToggle，需求 4.6）与删除（DeleteStrategy，需求 4.7）。

import type { TradingStrategy } from "@/lib/data-access/types";
import { formatAction, formatComparator } from "./labels";
import StrategyToggle from "./strategy-toggle";
import DeleteStrategy from "./delete-strategy";

// 策略列表组件属性
export interface StrategyListProps {
  /** 待展示的策略集合 */
  strategies: TradingStrategy[];
  /** 某条策略启停/删除成功后的回调（触发父级刷新列表与市场状态） */
  onChanged?: () => void;
  /** 启停/删除失败后的回调，携带中文错误提示 */
  onError?: (message: string) => void;
}

/**
 * 策略列表。
 *
 * 参数:
 *   strategies (TradingStrategy[]): 策略集合
 *   onChanged (() => void | undefined): 变更成功回调
 *   onError ((message: string) => void | undefined): 变更失败回调
 *
 * 返回:
 *   JSX.Element: 策略列表或「暂无策略」空状态。
 */
export default function StrategyList({
  strategies,
  onChanged,
  onError,
}: StrategyListProps): JSX.Element {
  // 空列表：显示空状态而非错误（需求 4.2）
  if (strategies.length === 0) {
    return (
      <div className="strategy-list__empty" role="status">
        暂无策略
      </div>
    );
  }

  return (
    <ul className="strategy-list">
      {strategies.map((strategy) => (
        <li key={strategy.id} className="strategy-item">
          <div className="strategy-item__main">
            <span className="strategy-item__name">{strategy.name}</span>
            {/* 启用状态标识：文本 + 不同样式类，便于不依赖颜色区分（需求 4.1） */}
            <span
              className={
                strategy.enabled
                  ? "strategy-item__status strategy-item__status--enabled"
                  : "strategy-item__status strategy-item__status--disabled"
              }
            >
              {strategy.enabled ? "已启用" : "已停用"}
            </span>
          </div>

          {/* 策略详情：动作 + 触发条件（比较关系 + 电价阈值） */}
          <div className="strategy-item__detail">
            <span>动作：{formatAction(strategy.action)}</span>
            <span>
              触发条件：电价{formatComparator(strategy.condition.comparator)}{" "}
              {strategy.condition.priceThreshold}
            </span>
          </div>

          {/* 操作区：启停切换与删除（需求 4.6、4.7） */}
          <div className="strategy-item__actions">
            <StrategyToggle
              strategy={strategy}
              onToggled={onChanged}
              onError={onError}
            />
            <DeleteStrategy
              strategy={strategy}
              onDeleted={onChanged}
              onError={onError}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
