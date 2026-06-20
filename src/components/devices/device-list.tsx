// 设备列表 DeviceList（需求 1.6）
//
// 设计要点（设计文档「各功能区组件设计 / 2. 设备连接状态监控」）：
//   - 空列表时显示「暂无设备」空状态；空数据是正常状态而非错误（需求 1.6）。
//   - 否则渲染设备项，每项展示名称与连接状态徽章，可点击选中以查看详情（需求 1.8）。
//   - 纯展示 + 选中回调组件，不直接获取数据，由父级页面传入数据与回调。

"use client";

import type { Device } from "@/lib/data-access/types";
import StatusBadge from "./status-badge";

// 设备列表组件属性
export interface DeviceListProps {
  /** 设备数组（可能为空数组，表示「暂无设备」） */
  devices: Device[];
  /** 当前选中的设备 id（用于高亮），未选中为 null */
  selectedId: string | null;
  /** 选中某设备的回调，传入该设备 id */
  onSelect: (deviceId: string) => void;
}

/**
 * 设备列表组件。
 *
 * 参数:
 *   devices (Device[]): 设备数组
 *   selectedId (string | null): 当前选中设备 id
 *   onSelect ((deviceId: string) => void): 选中设备回调
 *
 * 返回:
 *   JSX.Element: 空列表时为「暂无设备」空状态；否则为可选中的设备列表。
 */
export default function DeviceList({
  devices,
  selectedId,
  onSelect,
}: DeviceListProps): JSX.Element {
  // 空列表：显示空状态而非错误（需求 1.6）
  if (devices.length === 0) {
    return (
      <div className="device-list__empty" role="status">
        暂无设备
      </div>
    );
  }

  return (
    <ul className="device-list">
      {devices.map((device) => {
        // 当前项是否处于选中态（用于视觉高亮）
        const active = device.id === selectedId;
        return (
          <li key={device.id} className="device-list__item">
            <button
              type="button"
              className={
                active
                  ? "device-list__entry device-list__entry--active"
                  : "device-list__entry"
              }
              // 选中态的无障碍语义
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(device.id)}
            >
              <span className="device-list__name">{device.name}</span>
              <StatusBadge status={device.connectionStatus} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
