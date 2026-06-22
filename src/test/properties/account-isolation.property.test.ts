// Feature: energy-storage-management, Property 21: 账户数据隔离
//
// 属性来源：design.md「Correctness Properties」Property 21
// Validates: Requirements 6.4, 6.5
//
// 属性陈述：对任意多账户种子数据与任意账户 a，账户作用域读取方法
// （listDevices(a)、getWeeklyRecords(a)、listStrategies(a) 等）返回的每一条数据
// 其 accountId 都等于 a；即任意账户 b ≠ a 名下的数据都不会出现在 a 的查询结果中。
//
// 被测对象：MockProvider 账户作用域读取方法（多账户种子数据）。
// 每个用例使用全新 MockProvider 实例（固定时钟，2..5 个账户，每账户含设备/记录/策略），保证确定性与隔离。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";

// 固定时钟基准（epoch 毫秒），保证种子数据确定可复现。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

describe("Property 21: 账户数据隔离", () => {
  it("Feature: energy-storage-management, Property 21 — 每个账户的查询结果仅含归属该账户的数据", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 账户数 2..5，确保存在跨账户隔离的验证空间
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (accountCount, seed) => {
          const provider = new MockProvider({
            seed,
            clock: () => FIXED_NOW,
            accountCount,
            deviceCount: 6,
            strategyCount: 4,
            recordDays: 4,
          });

          const accountsResult = await provider.listAccounts();
          expect(accountsResult.ok).toBe(true);
          if (!accountsResult.ok) return;
          const accountIds = accountsResult.data.map((a) => a.id);
          expect(accountIds.length).toBe(accountCount);

          // 收集所有设备 id（跨账户），用于验证单设备作用域查询不越界
          for (const accountId of accountIds) {
            // 1) listDevices(a)：每台设备 accountId === a
            const devices = await provider.listDevices(accountId);
            expect(devices.ok).toBe(true);
            if (!devices.ok) return;
            for (const device of devices.data) {
              expect(device.accountId).toBe(accountId);
            }

            // 2) getWeeklyRecords(a)（汇总）：每条记录 accountId === a
            const weekly = await provider.getWeeklyRecords(accountId);
            expect(weekly.ok).toBe(true);
            if (!weekly.ok) return;
            for (const record of weekly.data) {
              expect(record.accountId).toBe(accountId);
            }

            // 2b) getWeeklyRecords(a, deviceId)（单设备）：每条记录 accountId === a
            if (devices.data.length > 0) {
              const someDeviceId = devices.data[0].id;
              const weeklyOne = await provider.getWeeklyRecords(
                accountId,
                someDeviceId
              );
              expect(weeklyOne.ok).toBe(true);
              if (!weeklyOne.ok) return;
              for (const record of weeklyOne.data) {
                expect(record.accountId).toBe(accountId);
              }
            }

            // 3) listStrategies(a)：每条策略 accountId === a
            const strategies = await provider.listStrategies(accountId);
            expect(strategies.ok).toBe(true);
            if (!strategies.ok) return;
            for (const strategy of strategies.data) {
              expect(strategy.accountId).toBe(accountId);
            }
          }

          // 4) 跨账户互不可见：某账户的设备 id 不可在另一账户作用域内访问（NOT_FOUND）
          if (accountIds.length >= 2) {
            const firstDevices = await provider.listDevices(accountIds[0]);
            expect(firstDevices.ok).toBe(true);
            if (!firstDevices.ok) return;
            if (firstDevices.data.length > 0) {
              const foreignDeviceId = firstDevices.data[0].id;
              // 在 accountIds[1] 作用域内访问 accountIds[0] 的设备应返回 NOT_FOUND
              const cross = await provider.getDevice(
                accountIds[1],
                foreignDeviceId
              );
              expect(cross.ok).toBe(false);
              if (cross.ok) return;
              expect(cross.error.type).toBe("NOT_FOUND");
            }
          }
        }
      ),
      FC_PARAMS
    );
  });
});
