// 单个账户 API 路由（任务 21.16，需求 2.3、2.6、2.11、2.12、5.1、5.4）
//
// 设计文档「API 层（API_Layer / Route Handlers）」与目录结构（app/api/accounts/[id]/route.ts）要求：
//   GET    /api/accounts/[id] —— 返回单个账户详情（含资料）；不存在返回 404（需求 2.3）。
//   PUT    /api/accounts/[id] —— 更新账户资料；校验失败返回 400 且不改动原值（需求 2.6）。
//   DELETE /api/accounts/[id] —— 删除账户并级联移除其名下数据；
//                                成功返回剩余账户标识列表（需求 2.11），
//                                仅剩 1 个账户时返回 409（LAST_ACCOUNT，需求 2.12）。
//
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 通过共享的 api-response 助手将 Result<T> 映射为 HTTP 响应
// （VALIDATION→400、LAST_ACCOUNT→409、NOT_FOUND→404、TIMEOUT→504、PROVIDER_ERROR→500）；
// 意外异常统一兜底为 PROVIDER_ERROR，绝不向客户端泄漏栈信息（需求 5.4）。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  errorResponse,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";
import type { AccountProfileInput } from "@/lib/data-access/types";

/** 动态路由参数：账户唯一标识 */
interface RouteContext {
  params: { id: string };
}

/**
 * 获取单个账户详情（含账户资料）。
 *
 * @param request 请求对象（GET 无需 body）
 * @param context 路由上下文，含路径参数 id
 * @returns 成功 200 { data: Account }；不存在 404、内部错误 500 { error }
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    // 账户不存在时数据访问层返回 NOT_FOUND，经映射为 404
    const result = await provider.getAccount(context.params.id);
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}

/**
 * 更新指定账户的资料。
 *
 * 请求体为 JSON 格式的账户资料；畸形/缺失 JSON 由助手统一映射为 400（VALIDATION）。
 * 字段非法返回 400（VALIDATION，含 field）且不改动原值，也不影响其他账户（需求 2.6）；
 * 账户不存在返回 404；更新成功返回 200 并附带最新账户。
 *
 * @param request 请求对象，body 为 AccountProfileInput
 * @param context 路由上下文，含路径参数 id
 * @returns 成功 200 { data: Account }；校验失败 400、不存在 404、内部错误 500 { error }
 */
export async function PUT(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // 解析请求体；非法或缺失 JSON 统一按校验失败处理（400 VALIDATION）
    const parsed = await parseJsonBody<AccountProfileInput>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    // 经工厂获取当前数据提供者并更新资料；字段级校验由数据访问层统一执行
    const provider = getDataProvider();
    const result = await provider.updateAccountProfile(
      context.params.id,
      parsed.value
    );
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}

/**
 * 删除指定账户并级联移除其名下设备/充放电记录/交易策略。
 *
 * 仅剩 1 个账户时返回 409（LAST_ACCOUNT）且不删除（需求 2.12）；
 * 账户不存在返回 404；删除成功返回 200，data 含被删 id 与剩余账户标识列表（需求 2.11）。
 *
 * @param request 请求对象（DELETE 无需 body）
 * @param context 路由上下文，含路径参数 id
 * @returns 成功 200 { data: { id, remainingAccountIds } }；唯一账户 409、不存在 404、内部错误 500 { error }
 */
export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // 经工厂获取当前数据提供者并删除账户；唯一账户判定与级联删除由数据访问层执行
    const provider = getDataProvider();
    const result = await provider.deleteAccount(context.params.id);
    // 成功时直接返回数据访问层提供的剩余账户标识列表（remainingAccountIds）
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
