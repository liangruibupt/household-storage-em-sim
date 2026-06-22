// 电力交易策略集合路由（任务 21.17，需求 4.1、4.3、4.8、4.9、6.5）
//
// 端点：
//   GET  /api/trading/strategies?accountId=xxx  -> 返回该账户名下全部交易策略列表（需求 4.1）
//   POST /api/trading/strategies?accountId=xxx  -> 在该账户下创建策略，成功返回 201；
//                                                  校验失败返回 400 并携带 field（需求 4.3、4.8、4.9）
//
// 账户作用域：必填查询参数 accountId（需求 6.5）；缺失/空返回 400（VALIDATION），
// 未知 accountId 由数据访问层返回 404（NOT_FOUND）。
//
// 所有数据访问统一经由 getDataProvider() 获取的 IDataProvider 接口，
// 路由层只负责请求解析、Result<T> → HTTP 映射与响应封装，不感知具体数据来源。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import type { TradingStrategyInput } from "@/lib/data-access/types";
import {
  resultToResponse,
  errorResponse,
  getRequiredAccountId,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * GET /api/trading/strategies?accountId=xxx
 *
 * 获取指定账户名下全部交易策略列表（需求 4.1、6.5）。
 * 空列表为正常状态，返回 200 + { data: [] }。
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    const result = await getDataProvider().listStrategies(accountId.value);
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR(500)，不泄漏栈信息
    return providerErrorResponse();
  }
}

/**
 * POST /api/trading/strategies?accountId=xxx
 *
 * 在指定账户下创建交易策略：解析 JSON body，经数据访问层校验后写入并返回（需求 4.3、6.5）。
 * 创建成功返回 201；校验失败返回 400 且 body 携带 error.field（需求 4.8、4.9）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    // 解析请求体，畸形 JSON 直接按 400 校验失败返回
    const parsed = await parseJsonBody<TradingStrategyInput>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    const result = await getDataProvider().createStrategy(
      accountId.value,
      parsed.value
    );
    // 创建成功使用 201
    return resultToResponse(result, 201);
  } catch {
    return providerErrorResponse();
  }
}
