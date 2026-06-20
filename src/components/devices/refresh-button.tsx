// 设备列表刷新按钮 RefreshButton（需求 1.5）
//
// 设计要点（设计文档「各功能区组件设计 / 2. 设备连接状态监控」）：
//   - 点击触发重新拉取设备列表（需求 1.5），由父级页面在回调中执行刷新并在 3 秒内更新。
//   - 刷新进行中禁用按钮并提示，避免重复触发；纯交互组件，不直接获取数据。

"use client";

// 刷新按钮组件属性
export interface RefreshButtonProps {
  /** 点击刷新的回调（由父级页面执行重新拉取） */
  onRefresh: () => void;
  /** 是否正在刷新中：为 true 时禁用按钮并显示刷新中文案 */
  refreshing: boolean;
}

/**
 * 设备列表刷新按钮。
 *
 * 参数:
 *   onRefresh (() => void): 刷新回调
 *   refreshing (boolean): 是否刷新中
 *
 * 返回:
 *   JSX.Element: 可点击的刷新按钮；刷新中禁用并提示。
 */
export default function RefreshButton({
  onRefresh,
  refreshing,
}: RefreshButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="refresh-button"
      onClick={onRefresh}
      // 刷新进行中禁用，避免重复请求
      disabled={refreshing}
    >
      {refreshing ? "刷新中…" : "刷新"}
    </button>
  );
}
