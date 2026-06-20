"use client";

// 智能电力交易页面 TradingPage（需求 4.1、4.2、4.3、4.6、4.7、4.11）
//
// 设计要点（设计文档「智能电力交易」一节）：
//   - 页面挂载时并行请求 GET /api/trading/strategies 与 GET /api/trading/market。
//   - 组合各子组件：
//       StrategyForm   创建策略（需求 4.3）
//       StrategyList   展示策略与启用状态、启停、删除（需求 4.1、4.2、4.6、4.7）
//       MarketPanel    当前电价（需求 4.11）
//       ActionHistory  触发历史，倒序最多 50 条（需求 4.11）
//   - 使用共享 LoadingState / ErrorState；失败/超时时保留「上一次成功数据」并提供重试（需求 6.5、6.6）。
//   - 创建/启停/删除成功后刷新策略列表与市场状态，保证展示与服务端一致。

import { useCallback, useEffect, useState } from "react";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import StrategyForm from "@/components/trading/strategy-form";
import StrategyList from "@/components/trading/strategy-list";
import MarketPanel from "@/components/trading/market-panel";
import ActionHistory from "@/components/trading/action-history";
import { getJson } from "@/lib/http/client";
import type {
  MarketState,
  TradingStrategy,
} from "@/lib/data-access/types";

export default function TradingPage(): JSX.Element {
  // —— 策略列表状态：保留「上一次成功数据」，失败时不清空（需求 6.6） ——
  const [strategies, setStrategies] = useState<TradingStrategy[] | null>(null);
  const [strategiesLoading, setStrategiesLoading] = useState(false);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  // —— 市场状态：当前电价 + 触发历史（需求 4.11） ——
  const [market, setMarket] = useState<MarketState | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);

  // 子组件操作（启停/删除）失败时的提示
  const [actionError, setActionError] = useState<string | null>(null);

  // 拉取策略列表：成功更新数据并清空错误；失败仅记录错误，保留旧数据
  const loadStrategies = useCallback(async (): Promise<void> => {
    setStrategiesLoading(true);
    setStrategiesError(null);
    const result = await getJson<TradingStrategy[]>("/api/trading/strategies");
    setStrategiesLoading(false);
    if (result.ok) {
      // 空数组为正常状态（需求 4.2），直接展示
      setStrategies(result.data ?? []);
    } else {
      setStrategiesError(result.error.message);
    }
  }, []);

  // 拉取市场状态：成功更新数据并清空错误；失败仅记录错误，保留旧数据
  const loadMarket = useCallback(async (): Promise<void> => {
    setMarketLoading(true);
    setMarketError(null);
    const result = await getJson<MarketState>("/api/trading/market");
    setMarketLoading(false);
    if (result.ok) {
      setMarket(result.data);
    } else {
      setMarketError(result.error.message);
    }
  }, []);

  // 页面挂载时并行加载策略与市场状态
  useEffect(() => {
    void loadStrategies();
    void loadMarket();
  }, [loadStrategies, loadMarket]);

  // 策略发生变更（创建/启停/删除）后，刷新列表与市场状态并清空操作错误
  const handleStrategyChanged = useCallback((): void => {
    setActionError(null);
    void loadStrategies();
    void loadMarket();
  }, [loadStrategies, loadMarket]);

  return (
    <section className="trading-page">
      <h1 className="trading-page__heading">电力交易</h1>

      <div className="trading-page__layout">
        {/* —— 左栏：策略管理 —— */}
        <div className="trading-page__strategies">
          {/* 创建策略表单（需求 4.3） */}
          <StrategyForm onCreated={handleStrategyChanged} />

          <h2 className="trading-page__subheading">策略列表</h2>

          {/* 子组件操作失败提示（启停/删除） */}
          {actionError ? (
            <p className="trading-page__action-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {/* 首次加载且无数据时显示加载指示（需求 6.5） */}
          {strategiesLoading && strategies === null ? (
            <LoadingState message="正在加载策略…" />
          ) : strategiesError ? (
            // 失败：错误提示 + 重试，并保留已有列表（需求 6.6）
            <ErrorState message={strategiesError} onRetry={loadStrategies}>
              {strategies ? (
                <StrategyList
                  strategies={strategies}
                  onChanged={handleStrategyChanged}
                  onError={setActionError}
                />
              ) : null}
            </ErrorState>
          ) : (
            // 成功：展示策略列表（空列表显示「暂无策略」空状态，需求 4.2）
            <StrategyList
              strategies={strategies ?? []}
              onChanged={handleStrategyChanged}
              onError={setActionError}
            />
          )}
        </div>

        {/* —— 右栏：市场电价与触发历史 —— */}
        <aside className="trading-page__market">
          <h2 className="trading-page__subheading">市场行情</h2>

          {marketLoading && market === null ? (
            <LoadingState message="正在加载电价…" />
          ) : marketError ? (
            // 失败：错误提示 + 重试，并保留已有电价/历史（需求 6.6）
            <ErrorState message={marketError} onRetry={loadMarket}>
              {market ? (
                <>
                  <MarketPanel currentPrice={market.currentPrice} />
                  <h3 className="trading-page__subheading">触发历史</h3>
                  <ActionHistory history={market.history} />
                </>
              ) : null}
            </ErrorState>
          ) : market ? (
            <>
              {/* 当前电价（需求 4.11） */}
              <MarketPanel currentPrice={market.currentPrice} />
              <h3 className="trading-page__subheading">触发历史</h3>
              {/* 触发历史：倒序，最多 50 条（需求 4.11） */}
              <ActionHistory history={market.history} />
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
