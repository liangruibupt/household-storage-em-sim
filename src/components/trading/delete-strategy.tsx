"use client";

// 策略删除组件 DeleteStrategy（需求 4.7）
//
// 通过 DELETE /api/trading/strategies/[id] 删除单条策略。
// 成功后由父级回调刷新列表，删除的策略将不再可见（需求 4.7）。

import { useState } from "react";
import { sendJson } from "@/lib/http/client";
import type { TradingStrategy } from "@/lib/data-access/types";

// 删除组件属性
export interface DeleteStrategyProps {
  /** 目标策略 */
  strategy: TradingStrategy;
  /** 删除成功后的回调（通常触发列表刷新） */
  onDeleted?: () => void;
  /** 删除失败后的回调，携带中文错误提示 */
  onError?: (message: string) => void;
}

/**
 * 策略删除按钮。
 *
 * 行为：点击后向服务端发起 DELETE；请求进行中禁用按钮避免重复提交。
 *
 * 返回:
 *   JSX.Element: 删除按钮。
 */
export default function DeleteStrategy({
  strategy,
  onDeleted,
  onError,
}: DeleteStrategyProps): JSX.Element {
  // 请求进行中标记，用于禁用按钮防止重复点击
  const [submitting, setSubmitting] = useState(false);

  // 提交删除请求
  async function handleDelete(): Promise<void> {
    setSubmitting(true);
    const result = await sendJson<{ id: string }>(
      `/api/trading/strategies/${encodeURIComponent(strategy.id)}`,
      "DELETE"
    );
    setSubmitting(false);

    if (result.ok) {
      onDeleted?.();
    } else {
      onError?.(result.error.message);
    }
  }

  return (
    <button
      type="button"
      className="strategy-item__delete"
      onClick={handleDelete}
      disabled={submitting}
      aria-label={`删除策略 ${strategy.name}`}
    >
      删除
    </button>
  );
}
