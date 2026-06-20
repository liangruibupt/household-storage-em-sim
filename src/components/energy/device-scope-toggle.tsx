"use client";

// 设备范围切换 DeviceScopeToggle（需求 3.4）
//
// 设计要点（设计文档「各功能区组件设计 / 4. 充放电数据可视化」）：
//   - 当设备数 ≥ 2 时显示「单设备 / 全部汇总」切换（需求 3.4）。
//   - 切换后由父级重新请求 summary 与 weekly（携带 deviceId），并在 3 秒内更新。
//
// 该组件为受控组件：当前选中范围与变更回调均由父级提供，自身不持有数据请求逻辑。
// 当设备数 < 2 时返回 null，作为防御（父级通常也会条件渲染）。

import type { Device } from "@/lib/data-access/types";

// 设备范围切换组件的属性
export interface DeviceScopeToggleProps {
  /** 可选设备列表（用于构建下拉项） */
  devices: Device[];
  /** 当前选中的设备 id；null 表示「全部汇总」 */
  selectedDeviceId: string | null;
  /** 范围变更回调：传入设备 id 表示单设备，传入 null 表示全部汇总 */
  onChange: (deviceId: string | null) => void;
}

/** 「全部汇总」选项使用的特殊值（区别于任何真实设备 id） */
const ALL_SCOPE_VALUE = "__all__";

/**
 * 设备范围切换下拉。
 *
 * 参数:
 *   devices (Device[]): 设备列表
 *   selectedDeviceId (string | null): 当前选中范围
 *   onChange ((deviceId: string | null) => void): 范围变更回调
 *
 * 返回:
 *   JSX.Element | null: 设备数 ≥ 2 时渲染下拉切换，否则返回 null。
 */
export default function DeviceScopeToggle({
  devices,
  selectedDeviceId,
  onChange,
}: DeviceScopeToggleProps): JSX.Element | null {
  // 设备数 < 2 时不展示切换（需求 3.4）
  if (devices.length < 2) {
    return null;
  }

  // 处理下拉选择变更：特殊值 ALL_SCOPE_VALUE 映射为 null（全部汇总）
  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    onChange(value === ALL_SCOPE_VALUE ? null : value);
  };

  return (
    <div className="scope-toggle">
      <label className="scope-toggle__label" htmlFor="device-scope-select">
        数据范围
      </label>
      <select
        id="device-scope-select"
        className="scope-toggle__select"
        value={selectedDeviceId ?? ALL_SCOPE_VALUE}
        onChange={handleSelect}
      >
        {/* 默认项：全部设备汇总 */}
        <option value={ALL_SCOPE_VALUE}>全部汇总</option>
        {/* 单设备项：逐台列出 */}
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name}
          </option>
        ))}
      </select>
    </div>
  );
}
