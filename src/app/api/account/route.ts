// 账户 API 路由处理程序（任务 12.2，需求 2.1、2.2、2.3、2.4、2.5）
//
// 设计文档「API 层（API_Layer / Route Handlers）」要求：
//   - 仅依赖 IDataProvider 抽象接口，通过 getDataProvider() 获取当前实现；
//   - 将数据访问层返回的 Result<T> 映射为 HTTP 响应：
//       成功 → 200，body { data }
//       VALIDATION → 400，body { error: { type, message, field } }
//       NOT_FOUND  → 404
//       TIMEOUT    → 504
//       PROVIDER_ERROR → 500
//   - 捕获意外异常并转换为 PROVIDER_ERROR，绝不向客户端返回栈信息（需求 5.4）。
//
// 本路由提供两个端点：
//   GET  /api/account —— 获取当前账户资料（需求 2.1）
//   PUT  /api/account —— 更新账户资料（需求 2.2-2.5）

import { NextResponse } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import type {
  AccountProfileInput,
  DataError,
  DataErrorType,
  Result,
} from "@/lib/data-access/types";

/** 将结构化错误类型映射为 HTTP 状态码（对应设计文档错误处理决策表） */
function statusFromErrorType(type: DataErrorType): number {
  switch (type) {
    case "VALIDATION":
      return 400; // 输入校验失败，并在 body 中携带出错 field
    case "NOT_FOUND":
      return 404; // 请求的数据不存在
    case "TIMEOUT":
      return 504; // 数据来源超时
    case "PROVIDER_ERROR":
    default:
      return 500; // 数据来源内部错误（兜底）
  }
}

/**
 * 将数据访问层的 Result<T> 统一映射为 HTTP 响应。
 *
 * 成功返回 { data }（默认 200，可按需指定如创建用 201）；
 * 失败返回 { error }，状态码由 error.type 决定。
 */
function toHttpResponse<T>(result: Result<T>, successStatus = 200): NextResponse {
  if (result.ok) {
    return NextResponse.json({ data: result.data }, { status: successStatus });
  }
  // 失败：原样透传结构化错误（含校验场景下的 field），不附带任何栈信息
  return NextResponse.json(
    { error: result.error },
    { status: statusFromErrorType(result.error.type) }
  );
}

/** 构造一个 PROVIDER_ERROR 错误响应（用于兜底未预期异常，绝不泄漏栈信息） */
function providerErrorResponse(message: string): NextResponse {
  const error: DataError = { type: "PROVIDER_ERROR", message };
  return NextResponse.json({ error }, { status: 500 });
}

/**
 * GET /api/account
 *
 * 获取当前账户资料（需求 2.1）。成功返回 200 { data }，
 * 失败按 error.type 映射为对应状态码。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const provider = getDataProvider();
    const result = await provider.getAccountProfile();
    return toHttpResponse(result);
  } catch {
    // 捕获未预期异常并转换为 PROVIDER_ERROR，不返回任何内部细节或栈信息
    return providerErrorResponse("获取账户资料时发生内部错误");
  }
}

/**
 * PUT /api/account
 *
 * 更新账户资料（需求 2.2-2.5）。请求体为 JSON 格式的账户字段。
 * 校验失败（VALIDATION）映射为 400 并在 body 中携带出错的 field；
 * 更新成功返回 200 并附带最新的账户资料（需求 2.2）。
 * 请求体非法 JSON 时优雅处理为 400 VALIDATION（需求 2.3）。
 */
export async function PUT(request: Request): Promise<NextResponse> {
  // 1) 解析 JSON 请求体；非法 JSON 视为校验失败（400 VALIDATION），不泄漏解析异常细节
  let input: AccountProfileInput;
  try {
    input = (await request.json()) as AccountProfileInput;
  } catch {
    const error: DataError = {
      type: "VALIDATION",
      message: "请求体不是合法的 JSON 格式",
    };
    return NextResponse.json({ error }, { status: 400 });
  }

  // 2) 经由抽象数据提供者执行更新；字段级校验由数据访问层统一执行
  try {
    const provider = getDataProvider();
    const result = await provider.updateAccountProfile(input);
    // 成功返回最新资料（200）；VALIDATION → 400 且携带 field
    return toHttpResponse(result);
  } catch {
    // 捕获未预期异常并转换为 PROVIDER_ERROR，不返回任何内部细节或栈信息
    return providerErrorResponse("更新账户资料时发生内部错误");
  }
}
