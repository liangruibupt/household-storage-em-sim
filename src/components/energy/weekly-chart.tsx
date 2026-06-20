"use client";

// 过去 7 天充放电柱状图 WeeklyChart（需求 3.2、3.5）
//
// 设计要点（设计文档「各功能区组件设计 / 4. 充放电数据可视化」）：
//   - 使用 Recharts 按日期升序展示 7 天充/放电（需求 3.2）。
//   - 横轴为 7 个连续自然日；后端已零填充缺失日，缺失日显示为 0（需求 3.5）。
//   - Recharts 依赖浏览器渲染，必须置于客户端组件中（顶部 "use client"）。
//
// 该组件为纯展示组件：仅依赖父级传入的记录数组，不发起任何数据请求。
// 即便后端已保证升序与零填充，这里仍做防御性排序，保证横轴始终升序。

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChargeDischargeRecord } from "@/lib/data-access/types";

// 7 天充放电图组件的属性
export interface WeeklyChartProps {
  /** 7 天充放电记录；尚无成功数据时为 null */
  records: ChargeDischargeRecord[] | null;
}

// 图表内部使用的数据点结构
interface ChartPoint {
  /** 横轴标签（MM-DD，便于紧凑展示） */
  label: string;
  /** 充电量（kWh） */
  charge: number;
  /** 放电量（kWh） */
  discharge: number;
}

/**
 * 将完整日期（YYYY-MM-DD）转换为紧凑的横轴标签（MM-DD）。
 *
 * 参数:
 *   date (string): 形如 YYYY-MM-DD 的日期字符串
 *
 * 返回:
 *   string: MM-DD 标签；非预期格式时原样返回
 */
function toAxisLabel(date: string): string {
  // 期望格式 YYYY-MM-DD，取月份与日期部分
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date;
}

/**
 * 将原始记录映射为图表数据点，并按日期升序排序（需求 3.2）。
 *
 * 参数:
 *   records (ChargeDischargeRecord[]): 原始 7 天记录
 *
 * 返回:
 *   ChartPoint[]: 升序排列的图表数据点
 */
function toChartData(records: ChargeDischargeRecord[]): ChartPoint[] {
  return records
    // 防御性升序排序：按日期字符串字典序即等价于时间升序（YYYY-MM-DD）
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      label: toAxisLabel(r.date),
      charge: r.chargeKwh,
      discharge: r.dischargeKwh,
    }));
}

/**
 * 过去 7 天充放电柱状图。
 *
 * 参数:
 *   records (ChargeDischargeRecord[] | null): 7 天充放电记录
 *
 * 返回:
 *   JSX.Element: Recharts 柱状图；无数据时显示占位提示。
 */
export default function WeeklyChart({ records }: WeeklyChartProps): JSX.Element {
  // 尚无数据时显示占位提示，避免渲染空图表
  if (!records || records.length === 0) {
    return (
      <div className="weekly-chart weekly-chart--empty">
        <p className="weekly-chart__empty-text">暂无 7 天充放电数据</p>
      </div>
    );
  }

  // 映射并升序排序为图表数据
  const data = toChartData(records);

  return (
    <div className="weekly-chart">
      <h2 className="weekly-chart__title">过去 7 天充放电（kWh）</h2>
      {/* 固定高度容器配合 ResponsiveContainer 自适应宽度 */}
      <div className="weekly-chart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e7eb" />
            {/* 横轴：7 个自然日，升序展示（需求 3.2、3.5） */}
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals />
            <Tooltip
              formatter={(value: number | string) =>
                typeof value === "number" ? value.toFixed(2) : value
              }
            />
            <Legend />
            {/* 充电量与放电量两组柱子；中文图例 */}
            <Bar
              dataKey="charge"
              name="充电量"
              fill="#4dabf7"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="discharge"
              name="放电量"
              fill="#f59f00"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
