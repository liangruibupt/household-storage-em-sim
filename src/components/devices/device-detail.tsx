// 设备详情 DeviceDetail（需求 1.8）
//
// 设计要点（设计文档「各功能区组件设计 / 2. 设备连接状态监控」）：
//   - 选中某设备时，经 GET /api/devices/[id] 拉取详情，展示名称、唯一标识、
//     连接状态与「精确到秒」的最近状态更新时间（需求 1.8）。
//   - 加载时显示 LoadingState；失败/超时时显示 ErrorState（含重试）并保留上一次成功详情。
//   - 通过 HTTP 客户端封装（getJson）访问 API，绝不直接依赖数据来源实现（需求 5.1、5.4）。

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataError, DeviceDetail as DeviceDetailModel } from "@/lib/data-access/types";
import { getJson } from "@/lib/http/client";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import StatusBadge from "./status-badge";

// 设备详情组件属性
export interface DeviceDetailProps {
  /** 待展示详情的设备 id */
  deviceId: string;
}

/**
 * 将 ISO8601 时间字符串格式化为「精确到秒」的本地展示文本（需求 1.8）。
 * 输出格式：YYYY-MM-DD HH:mm:ss。无法解析时原样返回，避免渲染异常。
 *
 * 参数:
 *   iso (string): ISO8601 时间字符串
 *
 * 返回:
 *   string: 精确到秒的时间文本
 */
function formatToSecond(iso: string): string {
  const date = new Date(iso);
  // 解析失败（非法时间）则原样返回输入
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  // 两位补零辅助
  const pad = (n: number): string => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * 设备详情组件。
 *
 * 参数:
 *   deviceId (string): 设备唯一标识
 *
 * 返回:
 *   JSX.Element: 设备详情视图（含加载、错误保留与重试）。
 */
export default function DeviceDetail({ deviceId }: DeviceDetailProps): JSX.Element {
  // 上一次成功的详情数据；失败时保留不清空
  const [detail, setDetail] = useState<DeviceDetailModel | null>(null);
  // 加载态
  const [loading, setLoading] = useState<boolean>(false);
  // 最近一次错误；成功后清空
  const [error, setError] = useState<DataError | null>(null);

  // 请求序号：丢弃过期响应，避免快速切换设备时的竞态覆盖
  const seqRef = useRef(0);

  // 拉取指定设备详情
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    // 经 HTTP 客户端封装访问详情端点（路径参数需编码）
    const result = await getJson<DeviceDetailModel>(
      `/api/devices/${encodeURIComponent(deviceId)}`
    );

    // 已有更新请求发起则丢弃本次陈旧结果
    if (seq !== seqRef.current) {
      return;
    }

    if (result.ok) {
      // 成功：更新详情、清空错误
      setDetail(result.data);
      setError(null);
    } else {
      // 失败/超时：仅记录错误，保留上一次成功详情（需求 1.7）
      setError(result.error);
    }
    setLoading(false);
  }, [deviceId]);

  // 设备 id 变化时重新拉取详情
  useEffect(() => {
    void load();
  }, [load]);

  // 初次加载且尚无任何详情时显示加载指示
  if (loading && detail === null) {
    return <LoadingState message="加载设备详情…" />;
  }

  // 详情主体（在错误态下作为 children 传入 ErrorState 以保留展示）
  const content =
    detail !== null ? (
      <dl className="device-detail">
        <div className="device-detail__row">
          <dt className="device-detail__term">名称</dt>
          <dd className="device-detail__desc">{detail.name}</dd>
        </div>
        <div className="device-detail__row">
          <dt className="device-detail__term">唯一标识</dt>
          <dd className="device-detail__desc">{detail.id}</dd>
        </div>
        <div className="device-detail__row">
          <dt className="device-detail__term">连接状态</dt>
          <dd className="device-detail__desc">
            <StatusBadge status={detail.connectionStatus} />
          </dd>
        </div>
        <div className="device-detail__row">
          <dt className="device-detail__term">最近状态更新时间</dt>
          {/* 精确到秒展示（需求 1.8） */}
          <dd className="device-detail__desc">
            {formatToSecond(detail.lastStatusUpdatedAt)}
          </dd>
        </div>
      </dl>
    ) : null;

  // 存在错误：显示错误提示 + 重试，并在下方保留上一次成功详情（需求 1.7）
  if (error) {
    return (
      <ErrorState message={error.message} onRetry={() => void load()}>
        {content}
      </ErrorState>
    );
  }

  // 正常展示详情
  return content ?? <div className="device-detail__empty">暂无详情</div>;
}
