// 电力交易策略集合路由（任务 12.4，需求 4.1、4.3、4.8、4.9）
//
// 端点：
//   GET  /api/trading/strategies  -> 返回全部交易策略列表（需求 4.1）
//   POST /api/trading/strategies  -> 创建策略，成功返回 201；校验失败返回 400 并携带 field（需求 4.3、4.8、4.9）
//
// 所有数据访问统一经由 getDataProvider() 获取的 IDataProvider 接口，
// 路由层只负责请求解析、Result<T> → HTTP 映射与响应封装，不感知具体数据来源。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import type { TradingStrategyInput } from "@/lib/data-access/types";
import {
  resultToResponse,
  errorResponse,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * GET /api/trading/strategies
 *
 * 获取全部交易策略列表（需求 4.1）。空列表为正常状态，返回 200 + { data: [] }。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDataProvider().listStrategies();
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR(500)，不泄漏栈信息
    return providerErrorResponse();
  }
}

/**
 * POST /api/trading/strategies
 *
 * 创建交易策略：解析 JSON body，经数据访问层校验后写入并返回（需求 4.3）。
 * 创建成功返回 201；校验失败返回 400 且 body 携带 error.field（需求 4.8、4.9）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 解析请求体，畸形 JSON 直接按 400 校验失败返回
    const parsed = await parseJsonBody<TradingStrategyInput>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    const result = await getDataProvider().createStrategy(parsed.value);
    // 创建成功使用 201
    return resultToResponse(result, 201);
  } catch {
    return providerErrorResponse();
  }
}
