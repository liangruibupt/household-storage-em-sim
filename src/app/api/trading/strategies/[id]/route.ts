// 单个电力交易策略路由（任务 21.17，需求 4.6、4.7、4.8、4.9、6.5）
//
// 端点：
//   PUT    /api/trading/strategies/[id]?accountId=xxx  -> 部分更新该账户名下策略（含启停 enabled），
//                                                         返回更新后结果（需求 4.6）
//   DELETE /api/trading/strategies/[id]?accountId=xxx  -> 删除该账户名下策略，返回被删除的 id（需求 4.7）
//
// 账户作用域：必填查询参数 accountId（需求 6.5）；缺失/空返回 400（VALIDATION）。
// 错误映射：不存在或不属于该账户 -> 404（NOT_FOUND）；校验失败 -> 400 并携带 field（VALIDATION）。
// 数据访问统一经由 getDataProvider()，路由层不感知具体数据来源。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import type { TradingStrategyPatch } from "@/lib/data-access/types";
import {
  resultToResponse,
  errorResponse,
  getRequiredAccountId,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";

/** App Router 动态段参数类型：路径中的 [id] */
interface RouteContext {
  params: { id: string };
}

/**
 * PUT /api/trading/strategies/[id]?accountId=xxx
 *
 * 部分更新指定账户名下策略（可用于启停切换 enabled 或修改名称/动作/触发条件，需求 4.6、6.5）。
 * 成功返回 200 + 更新后的策略；缺少 accountId 返回 400；不存在返回 404；校验失败返回 400 并携带 field。
 */
export async function PUT(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    const { id } = context.params;

    // 解析请求体，畸形 JSON 直接按 400 校验失败返回
    const parsed = await parseJsonBody<TradingStrategyPatch>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    const result = await getDataProvider().updateStrategy(
      accountId.value,
      id,
      parsed.value
    );
    // 更新成功返回最新结果（200），NOT_FOUND/VALIDATION 由映射函数处理
    return resultToResponse(result);
  } catch {
    return providerErrorResponse();
  }
}

/**
 * DELETE /api/trading/strategies/[id]?accountId=xxx
 *
 * 删除指定账户名下策略（需求 4.7、6.5）。成功返回 200 + { data: { id } }；
 * 缺少 accountId 返回 400；不存在返回 404。
 */
export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    const { id } = context.params;
    const result = await getDataProvider().deleteStrategy(accountId.value, id);
    return resultToResponse(result);
  } catch {
    return providerErrorResponse();
  }
}
