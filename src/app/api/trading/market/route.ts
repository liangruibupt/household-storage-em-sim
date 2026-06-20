// 电力市场状态路由（任务 12.4，需求 4.11）
//
// 端点：
//   GET /api/trading/market  -> 返回当前电价 + 触发动作历史（倒序，最多 50 条，需求 4.11）
//
// 数据访问统一经由 getDataProvider()，路由层仅做 Result<T> → HTTP 映射与响应封装。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import { resultToResponse, providerErrorResponse } from "@/lib/http/api-response";

/**
 * GET /api/trading/market
 *
 * 获取当前电价与最近触发历史（需求 4.11）。
 * 历史已由数据访问层按时间倒序并截断为最多 50 条，路由层直接透传。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDataProvider().getMarketState();
    return resultToResponse(result);
  } catch {
    // 兜底：意外异常转换为 PROVIDER_ERROR(500)，不泄漏栈信息
    return providerErrorResponse();
  }
}
