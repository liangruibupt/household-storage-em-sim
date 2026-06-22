// 设备监控页面 DevicesPage（需求 1.1、1.4、1.5、1.6、1.7、1.8、6.5、6.6）
//
// 设计要点（设计文档「各功能区组件设计 / 2. 设备连接状态监控」）：
//   - 从 AccountContext 读取 currentAccountId，调用 GET /api/devices?accountId=...，
//     仅展示与操作 Current_Account 名下设备（需求 6.5）。
//   - 以 currentAccountId 为依赖：切换账户后自动重新拉取并在 3 秒内更新（需求 6.6）。
//   - 维护 lastSuccessfulDevices：刷新失败时保留上一次成功列表不清空（需求 1.7）。
//   - 提供刷新入口重新拉取并在 3 秒内更新（需求 1.5）。
//   - 列表为空显示「暂无设备」空状态（需求 1.6，由 DeviceList 实现）。
//   - 选中设备时展示详情（名称、唯一标识、状态、精确到秒更新时间）（需求 1.8）。
//   - 失败/超时显示错误提示 + 重试，并保留已有列表（需求 1.7）。
//   - 尚无 Current_Account 时渲染中性空态，不发起请求、不报错（需求 6.5）。
//   - 经 HTTP 客户端封装访问 API，绝不直接依赖数据来源实现（需求 5.1、5.4）。

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataError, Device } from "@/lib/data-access/types";
import { getJson } from "@/lib/http/client";
import { useAccount } from "@/components/account/account-context";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import DeviceList from "@/components/devices/device-list";
import DeviceDetail from "@/components/devices/device-detail";
import RefreshButton from "@/components/devices/refresh-button";

/**
 * 设备监控页面。
 *
 * 返回:
 *   JSX.Element: 含刷新入口、设备列表与选中设备详情的监控视图。
 */
export default function DevicesPage(): JSX.Element {
  // 从账户上下文读取 Current_Account 标识；为 null 表示尚无账户（需求 6.5、6.6）
  const { currentAccountId } = useAccount();
  // 上一次成功获取的设备列表；失败时保留不清空（需求 1.7）
  const [devices, setDevices] = useState<Device[] | null>(null);
  // 加载态（首次加载与刷新共用）
  const [loading, setLoading] = useState<boolean>(false);
  // 最近一次错误；成功后清空
  const [error, setError] = useState<DataError | null>(null);
  // 当前选中的设备 id；用于展示详情与列表高亮
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 请求序号：丢弃过期响应，避免并发刷新的竞态覆盖
  const seqRef = useRef(0);

  // 拉取设备列表（首次加载与刷新共用），按 Current_Account 作用域请求
  const load = useCallback(async () => {
    // 无 Current_Account：不发起请求，中性空态由下方渲染处理（需求 6.5）
    if (currentAccountId === null) {
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    // 经 HTTP 客户端封装访问设备列表端点，携带 accountId 限定作用域（需求 6.5）
    const result = await getJson<Device[]>("/api/devices", {
      accountId: currentAccountId,
    });

    // 已有更新请求发起则丢弃本次陈旧结果
    if (seq !== seqRef.current) {
      return;
    }

    if (result.ok) {
      // 成功：更新列表、清空错误
      const list = result.data ?? [];
      setDevices(list);
      setError(null);
    } else {
      // 失败/超时：仅记录错误，保留上一次成功列表（需求 1.7）
      setError(result.error);
    }
    setLoading(false);
  }, [currentAccountId]);

  // 首次进入页面及 Current_Account 变化时重新拉取（切换后 3 秒内更新，需求 6.6）
  useEffect(() => {
    void load();
  }, [load]);

  // 切换账户时清空选中设备与上次列表，避免短暂展示其他账户数据（需求 6.5）
  useEffect(() => {
    setSelectedId(null);
    setDevices(null);
    setError(null);
  }, [currentAccountId]);

  // 选中设备回调
  const handleSelect = useCallback((deviceId: string) => {
    setSelectedId(deviceId);
  }, []);

  // 尚无 Current_Account：渲染中性空态，不报错（需求 6.5）
  if (currentAccountId === null) {
    return (
      <section className="devices-page">
        <h1 className="devices-page__title">设备监控</h1>
        <p className="devices-page__empty" role="status">
          请先选择账户
        </p>
      </section>
    );
  }

  // 首次加载且尚无任何列表数据时显示加载指示（需求 6.5）
  if (loading && devices === null) {
    return (
      <section className="devices-page">
        <h1 className="devices-page__title">设备监控</h1>
        <LoadingState message="加载设备列表…" />
      </section>
    );
  }

  // 列表主体：当已有成功数据时渲染列表（空数组由 DeviceList 显示「暂无设备」）
  const listContent =
    devices !== null ? (
      <DeviceList
        devices={devices}
        selectedId={selectedId}
        onSelect={handleSelect}
      />
    ) : null;

  return (
    <section className="devices-page">
      <header className="devices-page__header">
        <h1 className="devices-page__title">设备监控</h1>
        {/* 刷新入口：重新拉取并在 3 秒内更新（需求 1.5） */}
        <RefreshButton onRefresh={() => void load()} refreshing={loading} />
      </header>

      <div className="devices-page__body">
        <div className="devices-page__list">
          {error ? (
            // 失败/超时：错误提示 + 重试，并在下方保留已有列表（需求 1.7）
            <ErrorState message={error.message} onRetry={() => void load()}>
              {listContent}
            </ErrorState>
          ) : (
            listContent
          )}
        </div>

        {/* 选中设备时展示详情（需求 1.8）；携带 accountId 限定作用域（需求 6.5） */}
        {selectedId !== null ? (
          <div className="devices-page__detail">
            <h2 className="devices-page__detail-title">设备详情</h2>
            <DeviceDetail deviceId={selectedId} accountId={currentAccountId} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
