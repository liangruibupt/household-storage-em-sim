// 设备列表 API 路由（任务 21.17，需求 1.1、5.1、5.4、6.5）
//
// GET /api/devices?accountId=xxx —— 返回指定账户名下最多 200 台设备，
// connectionStatus 已按 60 秒窗口派生。
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 缺失/空 accountId 返回 400（VALIDATION）；未知 accountId 由数据访问层返回 404（NOT_FOUND）；
// 异常兜底为 PROVIDER_ERROR 且不泄漏栈信息。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  errorResponse,
  getRequiredAccountId,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * 获取指定账户名下的设备列表。
 *
 * @param request 请求对象，需携带查询参数 accountId
 * @returns 成功 200 { data: Device[] }；缺少 accountId 400、未知账户 404、内部错误 500 { error }
 */
export async function GET(request: Request): Promise<Response> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    const result = await provider.listDevices(accountId.value);
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
