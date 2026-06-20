// 领域算法：设备在线/离线连接状态判定（需求 1.2、1.3）
//
// connectionStatus 不是持久化字段，而是由数据访问层在读取时根据
// lastReportedAt 与"当前时间" now 派生计算（设计文档：在线/离线状态判定）。
// 判定语义（需求 1.3）：
//   isOnline(lastReportedAt, now) = (now - lastReportedAt) <= 60000ms
// 边界语义（设计文档 / Property 3）：
//   delta == 60000ms 为在线（online）
//   delta == 60001ms 为离线（offline）
// 本文件中的函数均为纯函数，便于属性测试（PBT）。

import type { ConnectionStatus } from "../data-access/types";

/** 在线判定窗口：最近 60 秒（60000 毫秒）内有上报即视为在线（需求 1.3） */
export const ONLINE_WINDOW_MS = 60_000;

/**
 * 时间戳输入类型。
 * 设备的 lastReportedAt 在领域类型中以 ISO8601 字符串表示（见 Device 类型），
 * 同时为便于调用与测试，这里也接受 epoch 毫秒数值或 Date 对象。
 */
export type TimestampInput = string | number | Date;

/**
 * 将多种形式的时间戳归一化为 epoch 毫秒数。
 *
 * 参数:
 *   ts (TimestampInput): ISO8601 字符串、epoch 毫秒数值或 Date 对象
 *
 * 返回:
 *   number: 对应的 epoch 毫秒数
 *
 * 异常:
 *   当传入无法解析的字符串时间戳时抛出 Error
 */
function toEpochMs(ts: TimestampInput): number {
  // 数值直接视为 epoch 毫秒
  if (typeof ts === "number") {
    return ts;
  }

  // Date 对象取其毫秒时间戳
  if (ts instanceof Date) {
    return ts.getTime();
  }

  // 字符串按 ISO8601 解析
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) {
    throw new Error(`无法解析的时间戳: ${ts}`);
  }
  return parsed;
}

/**
 * 判定设备在给定"当前时间"下是否在线。
 *
 * 当且仅当 (now - lastReportedAt) <= 60000ms 时返回 true（需求 1.3 / Property 3）。
 * 边界：delta 恰好为 60000ms 时仍为在线；60001ms 起为离线。
 * 说明：严格遵循设计文档的形式化判定 `delta <= 60000`，
 *       因此负值 delta（now 早于 lastReportedAt）同样满足 `<= 60000`，判为在线。
 *
 * 参数:
 *   lastReportedAt (TimestampInput): 设备最近一次上报状态的时间
 *   now (TimestampInput): 当前时间
 *
 * 返回:
 *   boolean: 在线返回 true，离线返回 false
 */
export function isOnline(
  lastReportedAt: TimestampInput,
  now: TimestampInput
): boolean {
  // 计算当前时间与最近上报时间之间的毫秒差
  const delta = toEpochMs(now) - toEpochMs(lastReportedAt);

  // 当且仅当 delta <= 60000ms 时视为在线（需求 1.3 / Property 3）
  return delta <= ONLINE_WINDOW_MS;
}

/**
 * 由最近上报时间与当前时间派生设备的连接状态。
 *
 * 参数:
 *   lastReportedAt (TimestampInput): 设备最近一次上报状态的时间
 *   now (TimestampInput): 当前时间
 *
 * 返回:
 *   ConnectionStatus: 在线返回 "online"，离线返回 "offline"（需求 1.2、1.3）
 */
export function deriveConnectionStatus(
  lastReportedAt: TimestampInput,
  now: TimestampInput
): ConnectionStatus {
  // 取值始终封闭于 {"online", "offline"}（需求 1.2 / Property 2）
  return isOnline(lastReportedAt, now) ? "online" : "offline";
}
