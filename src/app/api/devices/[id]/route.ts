// 设备详情 API 路由（任务 21.17，需求 1.8、5.1、5.4、6.5）
//
// GET /api/devices/[id]?accountId=xxx —— 返回指定账户名下单台设备详情（含精确到秒的最近状态更新时间）。
// 经 getDataProvider() 唯一入口访问数据访问层，仅依赖 IDataProvider 抽象接口；
// 缺失/空 accountId 返回 400（VALIDATION）；设备不存在或不属于该账户由数据访问层返回 404（NOT_FOUND）；
// 异常兜底为 PROVIDER_ERROR 且不泄漏栈信息。

import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  errorResponse,
  getRequiredAccountId,
  providerErrorResponse,
} from "@/lib/http/api-response";

/** 动态路由参数：设备唯一标识 */
interface RouteContext {
  params: { id: string };
}

/**
 * 获取指定账户名下单台设备详情。
 *
 * @param request 请求对象，需携带查询参数 accountId
 * @param context 路由上下文，含路径参数 id
 * @returns 成功 200 { data: DeviceDetail }；缺少 accountId 400、不存在 404、内部错误 500 { error }
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // 解析必填的账户作用域参数；缺失/空白时返回 400（VALIDATION）
    const accountId = getRequiredAccountId(request);
    if (!accountId.ok) {
      return errorResponse(accountId.error);
    }

    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    // 设备不存在或不属于该账户时，数据访问层返回 NOT_FOUND，经映射为 404
    const result = await provider.getDevice(
      accountId.value,
      context.params.id
    );
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息
    return providerErrorResponse();
  }
}
