"use client";

// 策略启停切换组件 StrategyToggle（需求 4.6）
//
// 通过 PUT /api/trading/strategies/[id] 提交 { enabled } 补丁，切换单条策略的启用状态。
// 组件自身只负责发起请求与请求中禁用按钮；成功后由父级回调刷新列表，保证展示与服务端一致。

import { useState } from "react";
import { sendJson } from "@/lib/http/client";
import type { TradingStrategy } from "@/lib/data-access/types";

// 启停切换组件属性
export interface StrategyToggleProps {
  /** 目标策略 */
  strategy: TradingStrategy;
  /** 切换成功后的回调（通常触发列表与市场状态刷新） */
  onToggled?: () => void;
  /** 切换失败后的回调，携带中文错误提示 */
  onError?: (message: string) => void;
  /**
   * 账户作用域标识（Current_Account）。PUT 请求据此附加 ?accountId=...，
   * 仅可启停该账户名下策略（需求 6.5）。
   */
  accountId?: string;
}

/**
 * 策略启停切换按钮。
 *
 * 行为：点击后将 enabled 取反并 PUT 到服务端；请求进行中禁用按钮避免重复提交。
 *
 * 返回:
 *   JSX.Element: 启停切换按钮。
 */
export default function StrategyToggle({
  strategy,
  onToggled,
  onError,
  accountId,
}: StrategyToggleProps): JSX.Element {
  // 请求进行中标记，用于禁用按钮防止重复点击
  const [submitting, setSubmitting] = useState(false);

  // 提交启停切换：将当前 enabled 取反
  async function handleToggle(): Promise<void> {
    setSubmitting(true);
    const result = await sendJson<TradingStrategy>(
      `/api/trading/strategies/${encodeURIComponent(strategy.id)}`,
      "PUT",
      { enabled: !strategy.enabled },
      // 携带 accountId 限定作用域（需求 6.5）
      { accountId }
    );
    setSubmitting(false);

    if (result.ok) {
      onToggled?.();
    } else {
      onError?.(result.error.message);
    }
  }

  return (
    <button
      type="button"
      className="strategy-item__toggle"
      onClick={handleToggle}
      disabled={submitting}
      // 无障碍语义：明确指出该操作会把策略切换为启用还是停用
      aria-label={strategy.enabled ? "停用策略" : "启用策略"}
    >
      {strategy.enabled ? "停用" : "启用"}
    </button>
  );
}
