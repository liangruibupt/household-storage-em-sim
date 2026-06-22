// Feature: energy-storage-management, Property 20: 账户删除级联移除归属数据
//
// 属性来源：design.md「Correctness Properties」Property 20
// Validates: Requirements 2.11
//
// 属性陈述：对任意含 2 个及以上账户的账户集合与其中任一账户 a，deleteAccount(a) 成功后：
//   - listAccounts() 不再包含 a；
//   - a 名下的 Device、Charge_Discharge_Record 与 Trading_Strategy 均不可访问
//     （对 a 的账户作用域读取返回 NOT_FOUND）；
//   - 任意其他账户 b ≠ a 及其名下数据保持不变。
//
// 被测对象：MockProvider.deleteAccount + 账户作用域读取方法。
// 每个用例使用全新 MockProvider 实例（固定时钟，2..5 个账户，每账户含设备/策略），保证确定性与隔离。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";

// 固定时钟基准（epoch 毫秒），保证种子数据确定可复现。
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

describe("Property 20: 账户删除级联移除归属数据", () => {
  it("Feature: energy-storage-management, Property 20 — 删除后归属数据不可访问，其他账户不变", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 账户数 2..5（保证非唯一账户，可删除）
        fc.integer({ min: 2, max: 5 }),
        // 用于确定性选取删除目标的索引基
        fc.nat(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (accountCount, pickBase, seed) => {
          const provider = new MockProvider({
            seed,
            clock: () => FIXED_NOW,
            accountCount,
            deviceCount: 5,
            strategyCount: 3,
            recordDays: 3,
          });

          const before = await provider.listAccounts();
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          expect(before.data.length).toBe(accountCount);

          // 确定性选取删除目标 a，以及一个其他账户 b ≠ a
          const targetIndex = pickBase % before.data.length;
          const targetId = before.data[targetIndex].id;
          const otherId = before.data[(targetIndex + 1) % before.data.length].id;
          expect(otherId).not.toBe(targetId);

          // 记录其他账户 b 删除前的归属数据
          const otherDevicesBefore = await provider.listDevices(otherId);
          const otherStrategiesBefore = await provider.listStrategies(otherId);
          expect(otherDevicesBefore.ok).toBe(true);
          expect(otherStrategiesBefore.ok).toBe(true);
          if (!otherDevicesBefore.ok || !otherStrategiesBefore.ok) return;

          // 删除账户 a：成功并返回剩余账户标识（需求 2.11）
          const del = await provider.deleteAccount(targetId);
          expect(del.ok).toBe(true);
          if (!del.ok) return;
          expect(del.data.id).toBe(targetId);
          expect(del.data.remainingAccountIds).not.toContain(targetId);
          expect(del.data.remainingAccountIds.length).toBe(accountCount - 1);

          // listAccounts() 不再包含 a
          const after = await provider.listAccounts();
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.data.some((acc) => acc.id === targetId)).toBe(false);
          expect(after.data.length).toBe(accountCount - 1);

          // a 名下数据均不可访问：账户作用域读取返回 NOT_FOUND（级联移除）
          for (const read of [
            await provider.getAccount(targetId),
            await provider.listDevices(targetId),
            await provider.getWeeklyRecords(targetId),
            await provider.getTodaySummary(targetId),
            await provider.listStrategies(targetId),
            await provider.getMarketState(targetId),
          ]) {
            expect(read.ok).toBe(false);
            if (read.ok) return;
            expect(read.error.type).toBe("NOT_FOUND");
          }

          // 其他账户 b 及其名下数据保持不变
          const otherDevicesAfter = await provider.listDevices(otherId);
          const otherStrategiesAfter = await provider.listStrategies(otherId);
          expect(otherDevicesAfter.ok).toBe(true);
          expect(otherStrategiesAfter.ok).toBe(true);
          if (!otherDevicesAfter.ok || !otherStrategiesAfter.ok) return;
          expect(otherDevicesAfter.data).toEqual(otherDevicesBefore.data);
          expect(otherStrategiesAfter.data).toEqual(otherStrategiesBefore.data);
        }
      ),
      FC_PARAMS
    );
  });
});
