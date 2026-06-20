// 单个电力交易策略路由（任务 12.4，需求 4.6、4.7、4.8、4.9）
//
// 端点：
//   PUT    /api/trading/strategies/[id]  -> 部分更新策略（含启停 enabled），返回更新后结果（需求 4.6）
//   DELETE /api/trading/strategies/[id]  -> 删除策略，返回被删除的 id（需求 4.7）
//
// 错误映射：不存在 -> 404（NOT_FOUND）；校验失败 -> 400 并携带 field（VALIDATION）。
// 数据访问统一经由 getDataProvider()，路由层不感知具体数据来源。

import type { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import type { TradingStrategyPatch } from "@/lib/data-access/types";
import {
  resultToResponse,
  errorResponse,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";

/** App Router 动态段参数类型：路径中的 [id] */
interface RouteContext {
  params: { id: string };
}

/**
 * PUT /api/trading/strategies/[id]
 *
 * 部分更新指定策略（可用于启停切换 enabled 或修改名称/动作/触发条件，需求 4.6）。
 * 成功返回 200 + 更新后的策略；不存在返回 404；校验失败返回 400 并携带 field。
 */
export async function PUT(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = context.params;

    // 解析请求体，畸形 JSON 直接按 400 校验失败返回
    const parsed = await parseJsonBody<TradingStrategyPatch>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    const result = await getDataProvider().updateStrategy(id, parsed.value);
    // 更新成功返回最新结果（200），NOT_FOUND/VALIDATION 由映射函数处理
    return resultToResponse(result);
  } catch {
    return providerErrorResponse();
  }
}

/**
 * DELETE /api/trading/strategies/[id]
 *
 * 删除指定策略（需求 4.7）。成功返回 200 + { data: { id } }；不存在返回 404。
 */
export async function DELETE(
  _request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = context.params;
    const result = await getDataProvider().deleteStrategy(id);
    return resultToResponse(result);
  } catch {
    return providerErrorResponse();
  }
}
