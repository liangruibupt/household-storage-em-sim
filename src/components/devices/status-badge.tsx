// 设备连接状态徽章 StatusBadge（需求 1.4）
//
// 设计要点（设计文档「各功能区组件设计 / 2. 设备连接状态监控」）：
//   - 为 online / offline 呈现「不同颜色」且「不同文本标签 + 图标」，
//     确保即使在不依赖颜色（如色盲、灰度显示）的情况下也能区分两种状态（需求 1.4）。
//   - 纯展示组件，无副作用、不依赖任何数据来源。

import type { ConnectionStatus } from "@/lib/data-access/types";

// 状态徽章组件属性
export interface StatusBadgeProps {
  /** 设备连接状态：online 或 offline */
  status: ConnectionStatus;
}

/**
 * 单个连接状态对应的展示配置：图标、文本标签与样式修饰类。
 * 图标与文本标签共同提供「非颜色」的可区分信息（需求 1.4）。
 */
const STATUS_PRESENTATION: Record<
  ConnectionStatus,
  { icon: string; label: string; modifier: string }
> = {
  // 在线：实心圆点 + 「在线」+ 绿色（modifier 控制颜色）
  online: { icon: "●", label: "在线", modifier: "status-badge--online" },
  // 离线：空心圆点 + 「离线」+ 灰色（图标与文本均不同于在线）
  offline: { icon: "○", label: "离线", modifier: "status-badge--offline" },
};

/**
 * 连接状态徽章组件。
 *
 * 参数:
 *   status (ConnectionStatus): 设备连接状态
 *
 * 返回:
 *   JSX.Element: 含图标 + 文本标签的徽章，颜色与文本/图标同时区分在线/离线（需求 1.4）。
 */
export default function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  // 依据状态取对应的图标、文本与样式修饰类
  const { icon, label, modifier } = STATUS_PRESENTATION[status];

  return (
    <span
      className={`status-badge ${modifier}`}
      // 无障碍：用文本标签作为可读名称，图标本身仅作装饰
      aria-label={label}
    >
      <span className="status-badge__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="status-badge__label">{label}</span>
    </span>
  );
}
