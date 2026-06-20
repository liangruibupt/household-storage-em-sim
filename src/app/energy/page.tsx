"use client";

// 充放电数据可视化页面 EnergyPage（需求 3.1、3.2、3.4、3.6）
//
// 设计要点（设计文档「各功能区组件设计 / 4. 充放电数据可视化」）：
//   - 并行请求 GET /api/energy/summary 与 GET /api/energy/weekly（需求 3.1、3.2）。
//   - 同时请求 GET /api/devices 获取设备列表，用于设备范围切换器与判定设备数（需求 3.4）。
//   - TodaySummaryCards：展示当日总充/放电量（kWh，2 位小数，需求 3.1）。
//   - WeeklyChart：Recharts 按日期升序展示 7 天，零填充日显示为 0（需求 3.2、3.5）。
//   - DeviceScopeToggle：设备数 ≥ 2 时显示单设备/全部汇总切换，切换后携带 deviceId
//     重新请求并在 3 秒内更新（需求 3.4）。
//   - 10 秒超时或失败时显示错误 + 重试，且不清空已有内容（需求 3.6）。
//     超时由底层 HTTP 客户端统一强制（10s，见 lib/http/client.ts）。
//
// 失败保留语义：summary / weekly / devices 各自维护「上一次成功数据」，
// 失败时仅记录错误、保留旧数据继续展示（ErrorState 通过 children 渲染既有内容）。

import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/http/client";
import type {
  ChargeDischargeRecord,
  DailySummary,
  DataError,
  Device,
} from "@/lib/data-access/types";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import TodaySummaryCards from "@/components/energy/today-summary-cards";
import WeeklyChart from "@/components/energy/weekly-chart";
import DeviceScopeToggle from "@/components/energy/device-scope-toggle";

/**
 * 根据选中范围构造查询串。
 *
 * 参数:
 *   deviceId (string | null): 选中设备 id；null 表示全部汇总
 *
 * 返回:
 *   string: 形如 "?deviceId=xxx" 的查询串；全部汇总时为空串
 */
function buildScopeQuery(deviceId: string | null): string {
  return deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
}

/**
 * 充放电数据可视化页面。
 *
 * 返回:
 *   JSX.Element: 含设备范围切换、当日总量卡片与 7 天柱状图的页面。
 */
export default function EnergyPage(): JSX.Element {
  // 「上一次成功数据」：失败时保留不清空（需求 3.6）
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [weekly, setWeekly] = useState<ChargeDischargeRecord[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);

  // 当前选中的设备范围：null 表示全部汇总
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // 加载态与最近一次错误
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<DataError | null>(null);

  // 请求序号：用于丢弃过期（被后续请求超越）的充放电响应，避免范围切换时的竞态
  const energySeqRef = useRef<number>(0);

  // 拉取设备列表（用于范围切换器；失败不阻断充放电主内容，仅不展示切换器）
  const loadDevices = useCallback(async (): Promise<void> => {
    const result = await getJson<Device[]>("/api/devices");
    if (result.ok) {
      setDevices(result.data ?? []);
    }
  }, []);

  // 并行拉取当日总量与 7 天数据（携带可选 deviceId）
  const loadEnergy = useCallback(
    async (deviceId: string | null): Promise<void> => {
      const seq = ++energySeqRef.current;
      // 进入加载态并清空上一次错误；既有数据保留，便于失败/切换时继续展示
      setLoading(true);
      setError(null);

      const query = buildScopeQuery(deviceId);
      // 并行发起两个请求（需求 3.1、3.2）；底层客户端各自强制 10s 超时（需求 3.6）
      const [summaryResult, weeklyResult] = await Promise.all([
        getJson<DailySummary>(`/api/energy/summary${query}`),
        getJson<ChargeDischargeRecord[]>(`/api/energy/weekly${query}`),
      ]);

      // 若已有更新的请求发起，丢弃本次陈旧结果（范围快速切换时的竞态保护）
      if (seq !== energySeqRef.current) {
        return;
      }

      // 任一请求失败/超时即记录错误并停止加载；保留既有数据（需求 3.6）
      if (!summaryResult.ok) {
        setError(summaryResult.error);
        setLoading(false);
        return;
      }
      if (!weeklyResult.ok) {
        setError(weeklyResult.error);
        setLoading(false);
        return;
      }

      // 两者均成功：更新「上一次成功数据」
      setSummary(summaryResult.data);
      setWeekly(weeklyResult.data);
      setLoading(false);
    },
    []
  );

  // 首次挂载：并行加载设备列表与（全部汇总范围的）充放电数据
  useEffect(() => {
    void loadDevices();
    void loadEnergy(null);
  }, [loadDevices, loadEnergy]);

  // 范围切换：更新选中范围并携带 deviceId 重新请求（需求 3.4）
  const handleScopeChange = useCallback(
    (deviceId: string | null): void => {
      setSelectedDeviceId(deviceId);
      void loadEnergy(deviceId);
    },
    [loadEnergy]
  );

  // 手动重试：重新拉取设备列表与当前范围的充放电数据（需求 3.6）
  const handleRetry = useCallback((): void => {
    void loadDevices();
    void loadEnergy(selectedDeviceId);
  }, [loadDevices, loadEnergy, selectedDeviceId]);

  // 是否已有可展示的成功数据（用于决定首屏加载指示 vs 保留内容）
  const hasData = summary !== null || weekly !== null;

  // 主内容：当日总量卡片 + 7 天柱状图（两者各自处理 null 占位）
  const content = (
    <>
      <TodaySummaryCards summary={summary} />
      <WeeklyChart records={weekly} />
    </>
  );

  return (
    <section className="energy-page">
      <header className="energy-page__header">
        <h1 className="energy-page__title">充放电数据</h1>
        {/* 设备数 ≥ 2 时显示范围切换器（需求 3.4） */}
        {devices && devices.length >= 2 ? (
          <DeviceScopeToggle
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onChange={handleScopeChange}
          />
        ) : null}
      </header>

      {error ? (
        // 失败/超时：显示错误 + 重试，并在下方保留既有内容（需求 3.6）
        <ErrorState message={error.message} onRetry={handleRetry}>
          {hasData ? content : null}
        </ErrorState>
      ) : loading && !hasData ? (
        // 首屏加载：尚无任何数据时显示加载指示（需求 6.5）
        <LoadingState message="正在加载充放电数据…" />
      ) : (
        <>
          {/* 范围切换/刷新进行中：在保留既有内容上方提示更新（需求 3.4、3.6） */}
          {loading ? <LoadingState message="正在更新…" /> : null}
          {content}
        </>
      )}
    </section>
  );
}
