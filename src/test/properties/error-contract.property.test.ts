// Feature: energy-storage-management, Property 16: 失败返回结构化错误且无部分数据
//
// 属性来源：design.md「Correctness Properties」Property 16
// Validates: Requirements 5.6
//
// 属性陈述：对任意导致失败的调用（数据不存在、校验失败、内部错误等），
// IDataProvider 方法的返回值满足 ok=false，且 error.type 属于 DataErrorType 枚举集合，
// 同时不携带任何业务数据结构（即结果对象中不含 data 字段）。
//
// 覆盖的失败分支：
//   - getDevice(未知 id)            -> NOT_FOUND
//   - getTodaySummary(未知 deviceId) -> NOT_FOUND
//   - getWeeklyRecords(未知 deviceId)-> NOT_FOUND
//   - updateAccountProfile(非法输入) -> VALIDATION
//   - createStrategy(非法输入)       -> VALIDATION
//   - updateStrategy(未知 id)        -> NOT_FOUND
//   - deleteStrategy(未知 id)        -> NOT_FOUND
//
// 测试隔离：每个用例使用全新 MockProvider 实例（固定 seed 与固定时钟），
// 避免跨用例的内存态污染，保证确定性可复现（与设计文档「确定性可测试」一致）。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FC_PARAMS } from "@/test/fc-config";
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import type {
  DataErrorType,
  Result,
  TradingStrategyInput,
} from "@/lib/data-access/types";
import {
  invalidAccountProfile,
  validAccountProfile,
} from "@/test/arbitraries/account";

// 固定 seed 与固定时钟，保证每个 MockProvider 实例的初始数据确定可复现。
const FIXED_SEED = 0x16e7;
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

// 账户作用域入参：seed-data 默认账户以 account-001 起始编号。
const ACCOUNT_ID = "account-001";

/** 构造一个隔离的、确定性的 MockProvider 实例。 */
function freshProvider(): MockProvider {
  return new MockProvider({ seed: FIXED_SEED, clock: () => FIXED_NOW });
}

/** DataErrorType 枚举的合法取值集合（需求 5.6）。 */
const VALID_ERROR_TYPES: ReadonlySet<DataErrorType> = new Set<DataErrorType>([
  "NOT_FOUND",
  "VALIDATION",
  "ACCOUNT_LIMIT",
  "LAST_ACCOUNT",
  "PROVIDER_ERROR",
  "TIMEOUT",
]);

/**
 * 断言一个失败结果满足 Property 16 的结构化错误契约：
 *   - ok === false；
 *   - error.type ∈ DataErrorType 集合，且等于期望类型；
 *   - error.message 为非空字符串；
 *   - 结果对象不携带任何业务数据（不含 data 字段）。
 *
 * @param result    被测方法返回的 Result
 * @param expected  期望的错误类型（NOT_FOUND / VALIDATION 等）
 */
function expectStructuredError<T>(
  result: Result<T>,
  expected: DataErrorType
): void {
  // 必须为失败结果
  expect(result.ok).toBe(false);
  if (result.ok) return; // 类型收窄

  // error.type 属于合法枚举集合，且精确匹配期望类型
  expect(VALID_ERROR_TYPES.has(result.error.type)).toBe(true);
  expect(result.error.type).toBe(expected);

  // 面向用户的中文提示为非空字符串
  expect(typeof result.error.message).toBe("string");
  expect(result.error.message.length).toBeGreaterThan(0);

  // 无部分数据：失败结果不得携带任何业务数据结构
  expect("data" in result).toBe(false);
  expect((result as { data?: unknown }).data).toBeUndefined();
}

// ============================================================
// 未知标识生成器：保证生成的 id 必不命中种子数据
// 种子设备 id 形如 "device-NNN"，策略 id 形如 "strategy-NNN"；
// 统一加 "unknown-" 前缀，确保与任何 seed 下的既有 id 都不冲突。
// ============================================================

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 生成形如 "unknown-xxxxx" 的、保证不存在于种子数据中的标识。 */
const unknownId: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALNUM.split("")), { minLength: 1, maxLength: 16 })
  .map((chars) => `unknown-${chars.join("")}`);

// ============================================================
// 非法策略创建输入生成器（每个变体均被 validateTradingStrategyInput 拒绝）
// 以 as 转型为 TradingStrategyInput，模拟 API 边界传入的不合法负载。
// ============================================================

const validConditionPart = {
  comparator: "greater_than" as const,
  priceThreshold: 1,
};

const invalidStrategyInput: fc.Arbitrary<TradingStrategyInput> = fc.oneof(
  // 名称为空（长度 0，越下界）
  fc.constant({
    name: "",
    action: "charge",
    condition: validConditionPart,
    enabled: true,
  } as TradingStrategyInput),
  // 名称超长（长度 101，越上界）
  fc.constant({
    name: "a".repeat(101),
    action: "discharge",
    condition: validConditionPart,
    enabled: false,
  } as TradingStrategyInput),
  // action 不属于 4 种枚举
  fc.constant({
    name: "valid name",
    action: "explode",
    condition: validConditionPart,
    enabled: true,
  } as unknown as TradingStrategyInput),
  // comparator 不属于 5 种枚举
  fc.constant({
    name: "valid name",
    action: "buy",
    condition: { comparator: "approximately", priceThreshold: 1 },
    enabled: true,
  } as unknown as TradingStrategyInput),
  // 电价阈值越上界（> 999999.99）
  fc.constant({
    name: "valid name",
    action: "sell",
    condition: { comparator: "less_than" as const, priceThreshold: 1_000_000 },
    enabled: true,
  } as TradingStrategyInput),
  // 电价阈值越下界（< 0）
  fc.constant({
    name: "valid name",
    action: "charge",
    condition: { comparator: "equal" as const, priceThreshold: -1 },
    enabled: true,
  } as TradingStrategyInput)
);

describe("Property 16: 失败返回结构化错误且无部分数据", () => {
  // ----------------------------------------------------------
  // NOT_FOUND 分支：读取/更新/删除不存在的资源
  // ----------------------------------------------------------

  it("Feature: energy-storage-management, Property 16 — getDevice(未知 id) 返回 NOT_FOUND 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const provider = freshProvider();
        const result = await provider.getDevice(ACCOUNT_ID, id);
        expectStructuredError(result, "NOT_FOUND");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — getTodaySummary(未知 deviceId) 返回 NOT_FOUND 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const provider = freshProvider();
        const result = await provider.getTodaySummary(ACCOUNT_ID, id);
        expectStructuredError(result, "NOT_FOUND");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — getWeeklyRecords(未知 deviceId) 返回 NOT_FOUND 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const provider = freshProvider();
        const result = await provider.getWeeklyRecords(ACCOUNT_ID, id);
        expectStructuredError(result, "NOT_FOUND");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — updateStrategy(未知 id) 返回 NOT_FOUND 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const provider = freshProvider();
        // 即便携带合法补丁，目标不存在仍应为 NOT_FOUND（而非 VALIDATION）
        const result = await provider.updateStrategy(ACCOUNT_ID, id, { enabled: true });
        expectStructuredError(result, "NOT_FOUND");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — deleteStrategy(未知 id) 返回 NOT_FOUND 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(unknownId, async (id) => {
        const provider = freshProvider();
        const result = await provider.deleteStrategy(ACCOUNT_ID, id);
        expectStructuredError(result, "NOT_FOUND");
      }),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // VALIDATION 分支：非法输入被拒
  // ----------------------------------------------------------

  it("Feature: energy-storage-management, Property 16 — updateAccountProfile(非法输入) 返回 VALIDATION 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(invalidAccountProfile, async ({ input }) => {
        const provider = freshProvider();
        const result = await provider.updateAccountProfile(ACCOUNT_ID, input);
        expectStructuredError(result, "VALIDATION");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — createStrategy(非法输入) 返回 VALIDATION 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(invalidStrategyInput, async (input) => {
        const provider = freshProvider();
        const result = await provider.createStrategy(ACCOUNT_ID, input);
        expectStructuredError(result, "VALIDATION");
      }),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // ACCOUNT_LIMIT / LAST_ACCOUNT 分支：账户上限与唯一账户保护
  // ----------------------------------------------------------

  it("Feature: energy-storage-management, Property 16 — createAccount(账户数已达 5) 返回 ACCOUNT_LIMIT 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(validAccountProfile, async (input) => {
        // 构造恰好 5 个账户的提供者；再次创建必被拒（需求 2.5、6.4）
        const provider = new MockProvider({
          seed: FIXED_SEED,
          clock: () => FIXED_NOW,
          accountCount: 5,
        });
        const result = await provider.createAccount(input);
        expectStructuredError(result, "ACCOUNT_LIMIT");
      }),
      FC_PARAMS
    );
  });

  it("Feature: energy-storage-management, Property 16 — deleteAccount(仅剩 1 个账户) 返回 LAST_ACCOUNT 且无数据", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        // 构造仅 1 个账户的提供者；删除唯一账户必被拒（需求 2.12）
        const provider = new MockProvider({
          seed: FIXED_SEED,
          clock: () => FIXED_NOW,
          accountCount: 1,
        });
        const result = await provider.deleteAccount(ACCOUNT_ID);
        expectStructuredError(result, "LAST_ACCOUNT");
      }),
      FC_PARAMS
    );
  });

  // ----------------------------------------------------------
  // 代表性示例（单元测试）：固定输入下的确定性失败契约
  // ----------------------------------------------------------
  describe("代表性示例", () => {
    it("getDevice 对明确不存在的 id 返回 NOT_FOUND 且不含 data", async () => {
      const provider = freshProvider();
      const result = await provider.getDevice(ACCOUNT_ID, "device-999999");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("NOT_FOUND");
      expect("data" in result).toBe(false);
    });

    it("createStrategy 对空名称返回 VALIDATION 且指明 field 且不含 data", async () => {
      const provider = freshProvider();
      const result = await provider.createStrategy(ACCOUNT_ID, {
        name: "",
        action: "charge",
        condition: { comparator: "greater_than", priceThreshold: 1 },
        enabled: true,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("VALIDATION");
      expect(result.error.field).toBe("name");
      expect("data" in result).toBe(false);
    });
  });
});
