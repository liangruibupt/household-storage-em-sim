// 共享加载态组件 LoadingState（需求 6.5）
//
// 所有功能区在数据请求进行中时显示统一的加载指示。
// 该组件无副作用、不依赖任何数据来源，可被各功能区客户端组件直接复用。

// 加载态组件的属性
export interface LoadingStateProps {
  /** 自定义加载提示文本，缺省为「加载中…」 */
  message?: string;
}

/**
 * 加载指示组件。
 *
 * 参数:
 *   message (string | undefined): 加载提示文本（缺省「加载中…」）
 *
 * 返回:
 *   JSX.Element: 带无障碍 role="status" 的加载指示。
 */
export default function LoadingState({
  message = "加载中…",
}: LoadingStateProps): JSX.Element {
  return (
    // role="status" + aria-live 让辅助技术感知加载状态变化（需求 6.5）
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state__spinner" aria-hidden="true" />
      <span className="loading-state__text">{message}</span>
    </div>
  );
}
