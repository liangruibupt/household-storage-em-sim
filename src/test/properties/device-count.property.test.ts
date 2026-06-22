// Feature: energy-storage-management, Property 1: 设备数量上限不变量
//
// 被测对象：src/lib/data-access/mock/mock-provider.ts 的 MockProvider.listDevices
// Validates: Requirements 1.1
//
// 断言不变量（对所有合法输入成立）：
//   对任意规模的种子设备数据，listDevices() 成功返回的设备列表长度都不超过 200。
//
// 覆盖种子规模：0 / 200 / >200（通过 MockProvider 构造选项 deviceCount 调节）。
//   - deviceCount = 0：无设备，列表长度应为 0；
//   - deviceCount = 200：恰好达到上限，列表长度应 ≤ 200；
//   - deviceCount > 200：超过上限，种子层与读取层均钳制，列表长度仍应 ≤ 200。
//
// 统一使用 FC_PARAMS（numRuns >= 100，确定性 seed）以保证可复现。
// 使用固定注入时钟（clock）消除对真实时间的依赖，保证确定性。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { MAX_DEVICES } from "@/lib/data-access/mock/seed-data";

// 设备数量上限（需求 1.1 / Property 1）
const DEVICE_LIMIT = 200;

// 固定注入时钟：返回恒定 epoch 毫秒，保证种子数据与读取派生完全确定，不依赖真实时间。
const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z 附近的固定时刻
const fixedClock = () => FIXED_NOW;

// 种子数据默认账户标识（seed-data 以 account-001 起始编号），作为账户作用域查询入参。
const FIRST_ACCOUNT_ID = "account-001";

/**
 * 断言给定 deviceCount 与 seed 构造的 MockProvider，其 listDevices(accountId)
 * 成功返回且长度 ≤ 200（账户作用域，需求 1.1、6.5 / Property 1）。
 *
 * @param deviceCount 期望设备数量（可超过上限以验证钳制）
 * @param seed 固定种子，保证可复现
 * @returns 列表长度处于 [0, 200] 时为 true
 */
async function listDevicesLengthWithinLimit(
  deviceCount: number,
  seed: number
): Promise<boolean> {
  const provider = new MockProvider({ seed, clock: fixedClock, deviceCount });
  // 账户作用域查询：以默认账户 account-001 为作用域
  const result = await provider.listDevices(FIRST_ACCOUNT_ID);

  // 必须为成功结果（需求 1.1 正常路径）
  if (!result.ok) return false;

  // 核心不变量：长度不超过 200，且为非负
  return result.data.length >= 0 && result.data.length <= DEVICE_LIMIT;
}

describe("Property 1: 设备数量上限不变量", () => {
  // 与 seed-data.ts 的常量保持一致，防止上限被意外改动
  it("MAX_DEVICES 常量等于 200", () => {
    expect(MAX_DEVICES).toBe(DEVICE_LIMIT);
  });

  // Feature: energy-storage-management, Property 1: 设备数量上限不变量
  // 对任意规模的种子设备数据（含远超 200 的规模），listDevices() 返回长度 ≤ 200。
  // Validates: Requirements 1.1
  it("Feature: energy-storage-management, Property 1 - 对任意种子规模，listDevices 长度 ≤ 200", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 种子规模覆盖 0、上限附近以及远超上限的广泛区间
        fc.integer({ min: 0, max: 5_000 }),
        // 任意固定 seed，保证不同种子下不变量同样成立
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (deviceCount, seed) => {
          return listDevicesLengthWithinLimit(deviceCount, seed);
        }
      ),
      FC_PARAMS
    );
  });

  // 显式覆盖关键种子规模边界：0 / 200 / >200
  it("覆盖边界种子规模 0 / 200 / >200，列表长度均 ≤ 200", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(0, DEVICE_LIMIT, DEVICE_LIMIT + 1, 1_000, 10_000),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (deviceCount, seed) => {
          return listDevicesLengthWithinLimit(deviceCount, seed);
        }
      ),
      FC_PARAMS
    );
  });

  // 固定示例断言三个关键种子规模下的精确长度语义
  it("固定示例：seed=0 时 0 → 0 条、200 → 200 条、>200 → 恰好钳制为 200 条", async () => {
    // 种子规模 0：无设备
    const empty = new MockProvider({ seed: 0, clock: fixedClock, deviceCount: 0 });
    const emptyResult = await empty.listDevices(FIRST_ACCOUNT_ID);
    expect(emptyResult.ok).toBe(true);
    if (emptyResult.ok) {
      expect(emptyResult.data.length).toBe(0);
    }

    // 种子规模 200：恰好达到上限
    const full = new MockProvider({ seed: 0, clock: fixedClock, deviceCount: DEVICE_LIMIT });
    const fullResult = await full.listDevices(FIRST_ACCOUNT_ID);
    expect(fullResult.ok).toBe(true);
    if (fullResult.ok) {
      expect(fullResult.data.length).toBe(DEVICE_LIMIT);
    }

    // 种子规模 >200：钳制为 200，不超过上限
    const over = new MockProvider({ seed: 0, clock: fixedClock, deviceCount: DEVICE_LIMIT + 500 });
    const overResult = await over.listDevices(FIRST_ACCOUNT_ID);
    expect(overResult.ok).toBe(true);
    if (overResult.ok) {
      expect(overResult.data.length).toBe(DEVICE_LIMIT);
      expect(overResult.data.length).toBeLessThanOrEqual(DEVICE_LIMIT);
    }
  });
});
