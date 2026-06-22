// 账户集合 API 路由（任务 21.16，需求 2.1、2.2、2.4、2.5、5.1、5.4、6.5）
//
// 设计文档「API 层（API_Layer / Route Handlers）」与目录结构（app/api/accounts/route.ts）要求：
//   GET  /api/accounts —— 返回全部账户列表（≤5），用于账户列表与切换器（需求 2.1）。
//   POST /api/accounts —— 创建新账户；成功返回 201（需求 2.4、2.5）。
//
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 通过共享的 api-response 助手将 Result<T> 映射为 HTTP 响应
// （VALIDATION→400、ACCOUNT_LIMIT→409、NOT_FOUND→404、TIMEOUT→504、PROVIDER_ERROR→500）；
// 意外异常统一兜底为 PROVIDER_ERROR，绝不向客户端泄漏栈信息（需求 5.4）。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  errorResponse,
  parseJsonBody,
  providerErrorResponse,
} from "@/lib/http/api-response";
import type { AccountProfileInput } from "@/lib/data-access/types";

/**
 * 获取全部账户列表（≤5）。
 *
 * @returns 成功 200 { data: Account[] }；内部错误 500 { error }
 */
export async function GET(): Promise<Response> {
  try {
    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    const result = await provider.listAccounts();
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}

/**
 * 创建新账户。
 *
 * 请求体为 JSON 格式的账户资料；畸形/缺失 JSON 由助手统一映射为 400（VALIDATION）。
 * 字段非法返回 400（VALIDATION，含 field）；账户数已达上限 5 个返回 409（ACCOUNT_LIMIT）；
 * 创建成功返回 201 并附带新账户（需求 2.4、2.5）。
 *
 * @param request 请求对象，body 为 AccountProfileInput
 * @returns 成功 201 { data: Account }；校验失败 400、达上限 409、内部错误 500 { error }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // 解析请求体；非法或缺失 JSON 统一按校验失败处理（400 VALIDATION）
    const parsed = await parseJsonBody<AccountProfileInput>(request);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }

    // 经工厂获取当前数据提供者并创建账户；字段级校验与上限判定由数据访问层执行
    const provider = getDataProvider();
    const result = await provider.createAccount(parsed.value);
    // 创建成功使用 201；失败按 error.type 映射对应状态码
    return resultToResponse(result, 201);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
