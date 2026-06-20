// 充放电「过去 7 天数据」API 路由（任务 12.3，需求 3.2、3.3、3.5）
//
// Next.js App Router Route Handler：GET /api/energy/weekly
// 支持可选查询参数 deviceId：
//   - 省略 deviceId  → 汇总名下全部设备的 7 天充放电记录
//   - 指定 deviceId  → 仅返回该设备；设备不存在时返回 404
//
// 返回恰好 7 条、按日期升序、含当日在内向前回溯 7 个连续自然日、
// 缺失日零填充的记录（由数据访问层即时派生，见 weekly.ts）。
//
// 数据访问统一经由 getDataProvider()（需求 5.1、5.4），借助共享的 api-response 工具
// 将 Result<T> 映射为 HTTP 响应，且绝不向客户端泄漏栈信息。

import { type NextRequest } from "next/server";
import { getDataProvider } from "@/lib/data-access/factory";
import {
  resultToResponse,
  providerErrorResponse,
} from "@/lib/http/api-response";

/**
 * GET /api/energy/weekly[?deviceId=xxx]
 *
 * 返回过去 7 个连续自然日（含当日）的充放电记录，按日期升序、缺失日零填充。
 * deviceId 省略表示全部设备汇总（需求 3.2、3.3、3.5）。
 *
 * @returns 成功 200 { data: ChargeDischargeRecord[] }；未知设备 404、内部错误 500 { error }
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    // 读取可选 deviceId；空值/空串一律视为「省略」→ 全部设备汇总
    const rawDeviceId = request.nextUrl.searchParams.get("deviceId");
    const deviceId =
      rawDeviceId && rawDeviceId.trim() !== "" ? rawDeviceId : undefined;

    // 经工厂获取当前数据提供者（当前为 MockProvider，未来可零改动替换）
    const provider = getDataProvider();
    const result = await provider.getWeeklyRecords(deviceId);

    // 将 Result<T> 映射为 HTTP 响应：成功 { data }/200，失败 { error }/状态由 error.type 决定
    return resultToResponse(result);
  } catch {
    // 兜底：将意外异常转换为 PROVIDER_ERROR（500），绝不返回栈信息（需求 5.4）
    return providerErrorResponse("获取 7 天充放电数据失败");
  }
}
