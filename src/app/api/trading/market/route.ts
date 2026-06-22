// 电力市场状态路由（任务 21.17，需求 4.11、6.5）
//
// 端点：
//   GET /api/trading/market?accountId=xxx  -> 返回该账户当前电价 + 触发动作历史
//                                             （倒序，最多 50 条，需求 4.11）
//
// 账户作用域：必填查询参数 accountId（需求 6.5）；缺失/空返回 400（VALIDATION），
// 未知 accountId 由数据访问层返回 404（NOT_FOUND）。
//
// 数据访问统一经由 getDataProvider()，路由层仅做 Result<T> → HTTP 映射与响应封装。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  errorResponse,
  getRequiredAccountId,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * GET /api/trading/market?accountId=xxx
 *
 * 获取指定账户当前电价与最近触发历史（需求 4.11、6.5）。
 * 历史已由数据访问层按时间倒序并截断为最多 50 条，路由层直接透传。
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    const result = await getDataProvider().getMarketState(accountId.value);
    return resultToResponse(result);
  } catch {
    // 兜底：意外异常转换为 PROVIDER_ERROR(500)，不泄漏栈信息
    return providerErrorResponse();
  }
}
