// 设备详情 API 路由（任务 12.1，需求 1.8、5.1、5.4）
//
// GET /api/devices/[id] —— 返回单台设备详情（含精确到秒的最近状态更新时间）。
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 将 Result<T> 映射为 HTTP 响应（200 / 404 / 500），异常兜底为 PROVIDER_ERROR 且不泄漏栈信息。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  providerErrorResponse,
} from "@/lib/http/api-response";

/** 动态路由参数：设备唯一标识 */
interface RouteContext {
  params: { id: string };
}

/**
 * 获取单台设备详情。
 *
 * @param _request 请求对象（此端点不使用，故以下划线标记）
 * @param context 路由上下文，含路径参数 id
 * @returns 成功 200 { data: DeviceDetail }；不存在 404 { error }；内部错误 500 { error }
 */
export async function GET(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    // 设备不存在时，数据访问层返回 NOT_FOUND，经映射为 404
    const result = await provider.getDevice(context.params.id);
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
