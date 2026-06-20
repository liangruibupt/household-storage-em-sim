"use client";

// 市场电价面板 MarketPanel（需求 4.11）
//
// 展示来自 GET /api/trading/market 的当前电价。
// 该组件为纯展示组件，电价数据由父级页面统一获取后传入。

// 市场面板组件属性
export interface MarketPanelProps {
  /** 当前电价（需求 4.11） */
  currentPrice: number;
}

/**
 * 当前电价展示面板。
 *
 * 参数:
 *   currentPrice (number): 当前电价
 *
 * 返回:
 *   JSX.Element: 当前电价卡片。
 */
export default function MarketPanel({
  currentPrice,
}: MarketPanelProps): JSX.Element {
  return (
    <div className="market-panel">
      <span className="market-panel__label">当前电价</span>
      {/* 电价保留 2 位小数展示，单位元/kWh */}
      <span className="market-panel__price">
        {currentPrice.toFixed(2)} 元/kWh
      </span>
    </div>
  );
}
