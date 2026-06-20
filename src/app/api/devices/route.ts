// 设备列表 API 路由（任务 12.1，需求 1.1、5.1、5.4）
//
// GET /api/devices —— 返回最多 200 台设备，connectionStatus 已按 60 秒窗口派生。
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 将 Result<T> 映射为 HTTP 响应（200 / 500），异常兜底为 PROVIDER_ERROR 且不泄漏栈信息。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * 获取设备列表。
 *
 * @returns 成功 200 { data: Device[] }；数据来源内部错误 500 { error }
 */
export async function GET(): Promise<Response> {
  try {
    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    const result = await provider.listDevices();
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
