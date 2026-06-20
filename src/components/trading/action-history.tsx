"use client";

// 触发动作历史 ActionHistory（需求 4.11）
//
// 设计要点（设计文档「智能电力交易」一节）：
//   - 按时间倒序展示最近触发的策略动作，最多 50 条（需求 4.11）。
//   - 历史数据由数据访问层保证倒序与截断，本组件作防御性兜底：再次倒序并截断至 50 条。
//   - 无历史时显示空状态，不显示错误。

import type { StrategyActionRecord } from "@/lib/data-access/types";
import { formatAction } from "./labels";

/** 历史展示上限（需求 4.11） */
const MAX_HISTORY = 50;

// 动作历史组件属性
export interface ActionHistoryProps {
  /** 触发动作记录集合（期望已倒序，组件内仍做兜底处理） */
  history: StrategyActionRecord[];
}

/**
 * 将 ISO8601 时间字符串格式化为本地可读时间；解析失败时原样返回。
 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN");
}

/**
 * 触发动作历史列表。
 *
 * 参数:
 *   history (StrategyActionRecord[]): 触发记录集合
 *
 * 返回:
 *   JSX.Element: 倒序、最多 50 条的历史列表或空状态。
 */
export default function ActionHistory({
  history,
}: ActionHistoryProps): JSX.Element {
  // 防御性兜底：按 triggeredAt 倒序排序，并截断至最多 50 条（需求 4.11）
  const ordered = [...history]
    .sort(
      (a, b) =>
        new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
    )
    .slice(0, MAX_HISTORY);

  // 空历史：显示空状态而非错误
  if (ordered.length === 0) {
    return (
      <div className="action-history__empty" role="status">
        暂无触发记录
      </div>
    );
  }

  return (
    <ul className="action-history">
      {ordered.map((record, index) => (
        // 同一策略可能多次触发，使用 strategyId + triggeredAt + index 组合保证 key 唯一
        <li
          key={`${record.strategyId}-${record.triggeredAt}-${index}`}
          className="action-history__item"
        >
          <span className="action-history__time">
            {formatTime(record.triggeredAt)}
          </span>
          <span className="action-history__name">{record.strategyName}</span>
          <span className="action-history__action">
            {formatAction(record.action)}
          </span>
          <span className="action-history__price">
            电价 {record.price.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}
