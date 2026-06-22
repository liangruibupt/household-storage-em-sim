// 设备实体的 fast-check 生成器（Arbitrary）
//
// 多账户模型（需求 6.4 / Property 21）下，生成的 Device / DeviceDetail 均携带
// 归属账户标识 accountId。生成器接收 accountId 作为参数，使调用方可为指定账户
// 批量生成名下设备，便于断言账户数据隔离。
//
// 设计要点：
// - connectionStatus 取值封闭于 {"online", "offline"}（需求 1.2）。
// - lastReportedAt 为合法 ISO8601 字符串。
// - 设备 id 形如 "device-001"，与种子数据命名风格一致。
//
// 对应需求：1.2、6.4（Property 21）

import fc from "fast-check";
import type {
  ConnectionStatus,
  Device,
  DeviceDetail,
} from "@/lib/data-access/types";

/** 连接状态生成器：封闭于 {online, offline}（需求 1.2） */
const connectionStatusArb: fc.Arbitrary<ConnectionStatus> = fc.constantFrom(
  "online",
  "offline"
);

/** 设备 id 生成器：形如 "device-001" 的稳定标识 */
const deviceIdArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 999 })
  .map((n) => `device-${String(n).padStart(3, "0")}`);

/** ISO8601 时间字符串生成器（覆盖常规时间范围） */
const isoTimeArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

/**
 * 生成归属指定账户的 Device。
 *
 * 参数:
 *   accountId (string): 归属账户标识（写入 device.accountId，需求 6.4）
 *
 * 返回:
 *   fc.Arbitrary<Device>: 携带 accountId 的设备生成器
 */
export function deviceArb(accountId: string): fc.Arbitrary<Device> {
  return fc.record({
    id: deviceIdArb,
    accountId: fc.constant(accountId),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    connectionStatus: connectionStatusArb,
    lastReportedAt: isoTimeArb,
  });
}

/**
 * 生成归属指定账户的 DeviceDetail（在 Device 基础上补充精确到秒的更新时间）。
 *
 * 参数:
 *   accountId (string): 归属账户标识（写入 accountId，需求 6.4）
 *
 * 返回:
 *   fc.Arbitrary<DeviceDetail>: 携带 accountId 的设备详情生成器
 */
export function deviceDetailArb(accountId: string): fc.Arbitrary<DeviceDetail> {
  return fc.record({
    id: deviceIdArb,
    accountId: fc.constant(accountId),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    connectionStatus: connectionStatusArb,
    lastReportedAt: isoTimeArb,
    lastStatusUpdatedAt: isoTimeArb,
  });
}
