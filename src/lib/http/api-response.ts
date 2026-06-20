// API 层响应封装与 Result<T> → HTTP 映射工具（任务 12.x，需求 5.4、5.6）
//
// 设计文档「API 层（API_Layer / Route Handlers）」要求：
//   - 成功：body 形如 { data }，状态码 200（创建用 201）。
//   - 失败：body 形如 { error: { type, message, field? } }，状态码由 error.type 决定：
//       VALIDATION    -> 400
//       NOT_FOUND     -> 404
//       TIMEOUT       -> 504
//       PROVIDER_ERROR-> 500
//   - 仅依赖 IDataProvider 接口，捕获意外异常并转换为 PROVIDER_ERROR，
//     绝不向客户端返回栈信息（需求 5.4）。
//
// 本模块为各 Route Handler 提供统一的响应构造与错误映射，避免在每个路由中重复实现。

import { NextResponse } from "next/server";
import type { Result, DataError, DataErrorType } from "@/lib/data-access/types";

/** 错误类型 → HTTP 状态码映射表（与设计文档「错误处理决策表」一致） */
const ERROR_STATUS: Record<DataErrorType, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  TIMEOUT: 504,
  PROVIDER_ERROR: 500,
};

/** 将结构化错误映射为对应的 HTTP 状态码；未知类型兜底为 500 */
export function statusForError(error: DataError): number {
  return ERROR_STATUS[error.type] ?? 500;
}

/**
 * 构造成功响应：body 为 { data }。
 *
 * @param data 业务数据
 * @param status HTTP 状态码，默认 200；创建场景传入 201
 */
export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/**
 * 构造失败响应：body 为 { error }，状态码由 error.type 决定。
 *
 * 仅透传结构化错误对象（type/message/field），不包含任何栈信息（需求 5.4）。
 */
export function errorResponse(error: DataError): NextResponse {
  return NextResponse.json({ error }, { status: statusForError(error) });
}

/**
 * 将数据访问层返回的 Result<T> 映射为 HTTP 响应。
 *
 * @param result 数据访问层统一返回值
 * @param successStatus 成功时的状态码，默认 200；创建场景传入 201
 */
export function resultToResponse<T>(
  result: Result<T>,
  successStatus = 200
): NextResponse {
  if (result.ok) {
    return successResponse(result.data, successStatus);
  }
  return errorResponse(result.error);
}

/**
 * 安全解析请求 JSON body。
 *
 * 报文缺失或格式非法时不抛出异常，而是返回 VALIDATION 错误（最终映射为 400），
 * 从而优雅处理畸形 JSON（需求 5.4、5.6）。
 *
 * @returns 解析成功返回 { ok: true, value }，失败返回 { ok: false, error }
 */
export async function parseJsonBody<T>(
  request: Request
): Promise<{ ok: true; value: T } | { ok: false; error: DataError }> {
  try {
    const value = (await request.json()) as T;
    return { ok: true, value };
  } catch {
    // 畸形或缺失的 JSON 报文统一按校验失败处理
    return {
      ok: false,
      error: {
        type: "VALIDATION",
        message: "请求体不是合法的 JSON 格式",
      },
    };
  }
}

/**
 * 统一包装意外异常为 PROVIDER_ERROR（500）。
 *
 * Route Handler 在调用数据访问层时若发生预期之外的异常（接口契约保证不抛业务异常，
 * 但仍需对意外情况兜底），用此函数转换为结构化错误响应，绝不泄漏栈信息（需求 5.4）。
 */
export function providerErrorResponse(message = "服务内部错误"): NextResponse {
  return errorResponse({ type: "PROVIDER_ERROR", message });
}

// ============================================================
// 兼容别名（供不同路由命名习惯共用同一套实现，保持单一事实来源）
// ============================================================

/** resultToResponse 的别名：将 Result<T> 映射为 HTTP 响应 */
export const toHttpResponse = resultToResponse;

/** providerErrorResponse 的别名：意外异常兜底为 PROVIDER_ERROR(500) */
export const unexpectedErrorResponse = providerErrorResponse;
