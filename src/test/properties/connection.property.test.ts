// 连接状态领域算法的属性测试（PBT）
//
// 被测对象：src/lib/domain/connection.ts
//   - deriveConnectionStatus(lastReportedAt, now): ConnectionStatus
//   - isOnline(lastReportedAt, now): boolean
//
// 本文件实现设计文档中的两条正确性属性：
//   - Property 2: 连接状态取值封闭（Validates: Requirements 1.2）
//   - Property 3: 在线/离线 60 秒窗口判定（Validates: Requirements 1.3）
//
// 统一使用 FC_PARAMS（numRuns >= 100，确定性 seed）以保证可复现。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import {
  deriveConnectionStatus,
  isOnline,
  ONLINE_WINDOW_MS,
} from "@/lib/domain/connection";
import type { ConnectionStatus } from "@/lib/data-access/types";

// 连接状态的合法取值集合（需求 1.2）
const VALID_STATUSES: ReadonlySet<ConnectionStatus> = new Set<ConnectionStatus>([
  "online",
  "offline",
]);

// 用于生成"当前时间" now 的 epoch 毫秒范围。
// 选取一个宽泛但安全（远离 Number 精度边界）的整数区间，
// 覆盖正常时间戳取值，同时与各类 delta 组合时不溢出。
const nowMsArb = fc.integer({ min: 0, max: 4_102_444_800_000 }); // 0 ~ 约公元 2100 年

describe("domain/connection 属性测试", () => {
  // Feature: energy-storage-management, Property 2: 连接状态取值封闭
  // 对任意设备的 lastReportedAt 与任意当前时间 now，
  // 派生出的 connectionStatus 都属于集合 {"online", "offline"}。
  // Validates: Requirements 1.2
  it("Feature: energy-storage-management, Property 2 - 连接状态取值封闭", () => {
    fc.assert(
      fc.property(
        // 直接生成两个独立时间戳，覆盖 now 在 lastReportedAt 之前/之后/相等的全部情形
        nowMsArb,
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (now, lastReportedAt) => {
          const status = deriveConnectionStatus(lastReportedAt, now);
          // 取值必须封闭于合法集合内
          expect(VALID_STATUSES.has(status)).toBe(true);
        }
      ),
      FC_PARAMS
    );
  });

  // Feature: energy-storage-management, Property 3: 在线/离线 60 秒窗口判定
  // 当且仅当 delta = (now - lastReportedAt) <= 60000ms 时为 online，否则为 offline。
  // Validates: Requirements 1.3
  describe("Feature: energy-storage-management, Property 3 - 在线/离线 60 秒窗口判定", () => {
    it("对任意 now 与 delta，online 当且仅当 delta <= 60000", () => {
      fc.assert(
        fc.property(
          nowMsArb,
          // delta 覆盖负值、窗口内、窗口外的广泛范围
          fc.integer({ min: -1_000_000, max: 1_000_000 }),
          (now, delta) => {
            const lastReportedAt = now - delta;
            const expectedOnline = delta <= ONLINE_WINDOW_MS; // 含负值同样满足 <= 60000
            const expectedStatus: ConnectionStatus = expectedOnline
              ? "online"
              : "offline";

            // isOnline 与判定语义一致
            expect(isOnline(lastReportedAt, now)).toBe(expectedOnline);
            // deriveConnectionStatus 与 isOnline 一致
            expect(deriveConnectionStatus(lastReportedAt, now)).toBe(
              expectedStatus
            );
          }
        ),
        FC_PARAMS
      );
    });

    // 显式覆盖关键边界：delta = 0 / 60000 / 60001 / 负值
    it("覆盖边界 delta = 0 / 60000 / 60001 / 负值", () => {
      fc.assert(
        fc.property(
          nowMsArb,
          fc.constantFrom(-1, -60_000, 0, 60_000, 60_001),
          (now, delta) => {
            const lastReportedAt = now - delta;
            const online = isOnline(lastReportedAt, now);
            const status = deriveConnectionStatus(lastReportedAt, now);

            if (delta <= ONLINE_WINDOW_MS) {
              // delta = -60000 / -1 / 0 / 60000 均为在线（含边界 60000）
              expect(online).toBe(true);
              expect(status).toBe<ConnectionStatus>("online");
            } else {
              // delta = 60001 为离线
              expect(online).toBe(false);
              expect(status).toBe<ConnectionStatus>("offline");
            }
          }
        ),
        FC_PARAMS
      );
    });

    // 固定示例断言四个关键边界，确保语义与 connection.ts 精确一致
    it("固定边界示例：60000 在线、60001 离线、0 在线、负值在线", () => {
      const now = 1_700_000_000_000;
      expect(deriveConnectionStatus(now - 0, now)).toBe("online"); // delta = 0
      expect(deriveConnectionStatus(now - 60_000, now)).toBe("online"); // delta = 60000（边界含）
      expect(deriveConnectionStatus(now - 60_001, now)).toBe("offline"); // delta = 60001
      expect(deriveConnectionStatus(now + 1, now)).toBe("online"); // delta = -1（负值）
    });
  });
});
