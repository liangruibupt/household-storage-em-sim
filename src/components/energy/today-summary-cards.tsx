// 当日充放电总量卡片 TodaySummaryCards（需求 3.1）
//
// 展示当日（00:00 至当前）总充电量与总放电量，单位 kWh，恒保留 2 位小数（需求 3.1）。
// 该组件为纯展示组件：仅依赖父级传入的 DailySummary，不发起任何数据请求。
// 当 summary 为 null（尚无成功数据）时以占位符「—」呈现，避免渲染异常。

import type { DailySummary } from "@/lib/data-access/types";

// 当日总量卡片组件的属性
export interface TodaySummaryCardsProps {
  /** 当日总量汇总；尚无成功数据时为 null */
  summary: DailySummary | null;
}

/**
 * 将 kWh 数值格式化为保留 2 位小数的字符串（需求 3.1）。
 *
 * 参数:
 *   value (number | undefined): 待格式化的数值
 *
 * 返回:
 *   string: 保留 2 位小数的字符串；无数据时返回占位符「—」
 */
function formatKwh(value: number | undefined): string {
  // 无数据（null/undefined）时显示占位符，区别于真实的 0.00
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(2);
}

/**
 * 当日充放电总量卡片。
 *
 * 参数:
 *   summary (DailySummary | null): 当日总量数据
 *
 * 返回:
 *   JSX.Element: 两张卡片，分别展示当日总充电量与总放电量（kWh，2 位小数）。
 */
export default function TodaySummaryCards({
  summary,
}: TodaySummaryCardsProps): JSX.Element {
  return (
    <div className="summary-cards">
      {/* 当日总充电量卡片 */}
      <div className="summary-card summary-card--charge">
        <span className="summary-card__label">当日总充电量</span>
        <span className="summary-card__value">
          {formatKwh(summary?.totalChargeKwh)}
          <span className="summary-card__unit"> kWh</span>
        </span>
      </div>

      {/* 当日总放电量卡片 */}
      <div className="summary-card summary-card--discharge">
        <span className="summary-card__label">当日总放电量</span>
        <span className="summary-card__value">
          {formatKwh(summary?.totalDischargeKwh)}
          <span className="summary-card__unit"> kWh</span>
        </span>
      </div>
    </div>
  );
}
