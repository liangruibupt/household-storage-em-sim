// 共享错误态组件 ErrorState（需求 6.6）
//
// 设计要点（设计文档「各功能区组件设计 / 1. 应用框架与导航」）：
//   - 当请求失败或超时（>10s）时显示错误提示，并提供「重试」按钮（需求 6.6）。
//   - 以非阻塞「横幅」形式呈现：通过 `children` 在错误提示下方继续渲染已有内容，
//     从而「保留已有内容」不被清空（需求 1.7、3.6、6.6）。各功能区将「上一次成功数据」
//     作为 children 传入，即可在错误态下继续展示旧数据。

import type { ReactNode } from "react";

// 错误态组件的属性
export interface ErrorStateProps {
  /** 面向用户的中文错误提示文本 */
  message: string;
  /** 重试回调：点击「重试」按钮时触发（需求 6.6） */
  onRetry?: () => void;
  /** 重试按钮文本，缺省为「重试」 */
  retryLabel?: string;
  /**
   * 已有内容。失败/超时时在错误横幅下方继续渲染，保证内容不被清空（需求 6.6）。
   */
  children?: ReactNode;
}

/**
 * 错误提示组件（含重试按钮，保留已有内容）。
 *
 * 参数:
 *   message (string): 错误提示文本
 *   onRetry (() => void | undefined): 重试回调
 *   retryLabel (string | undefined): 重试按钮文本（缺省「重试」）
 *   children (ReactNode | undefined): 错误态下继续展示的已有内容
 *
 * 返回:
 *   JSX.Element: 错误横幅 + 可选重试按钮 + 保留的已有内容。
 */
export default function ErrorState({
  message,
  onRetry,
  retryLabel = "重试",
  children,
}: ErrorStateProps): JSX.Element {
  return (
    <div className="error-state">
      {/* role="alert" 让辅助技术即时播报错误（需求 6.6） */}
      <div className="error-state__banner" role="alert">
        <span className="error-state__message">{message}</span>
        {onRetry ? (
          <button
            type="button"
            className="error-state__retry"
            onClick={onRetry}
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
      {/* 保留已有内容：失败/超时时不清空既有展示（需求 6.6） */}
      {children}
    </div>
  );
}
