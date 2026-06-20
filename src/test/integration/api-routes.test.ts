// API 路由集成测试（任务 12.5，需求 5.4、5.6）
//
// 目标：直接导入各 Route Handler 函数并以构造的 Request/NextRequest 调用，
// 断言其将数据访问层返回的 Result<T> 正确映射为 HTTP 响应：
//   成功            -> 200（创建用 201），body 形如 { data }
//   VALIDATION      -> 400（并携带出错 field），body 形如 { error: { type, message, field? } }
//   NOT_FOUND       -> 404
//   TIMEOUT         -> 504
//   PROVIDER_ERROR  -> 500（含意外异常兜底）
//
// 关键断言（需求 5.4、5.6）：
//   - 失败响应「只」包含 { error: { type, message, field? } }，不含 data（无部分数据）。
//   - 失败响应不泄漏任何栈信息（不含 "stack"）。
//
// 测试策略：
//   通过 vi.mock 接管 `@/lib/data-access/factory` 的 getDataProvider()，
//   使其返回一个可切换的「当前提供者」holder.current：
//     - 成功 / 404 等真实分支：注入真实 MockProvider（固定 seed 与时钟，确定可复现），
//       走真实的 Result<T> 流程，构成端到端集成验证；
//     - 500 / 504 / 抛异常等无法由 MockProvider 自然产出的分支：注入受控的 Fake 提供者，
//       精确返回指定的 Result 或抛出异常，从而覆盖完整的错误映射表。
//   每个用例前重置 holder（等价于 __resetDataProviderForTests 的隔离意图）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AccountProfileInput, DataErrorType } from "@/lib/data-access/types";
import type { IDataProvider } from "@/lib/data-access/provider";

// ------------------------------------------------------------
// 1) 以 vi.hoisted 创建可被 mock 工厂引用的「当前提供者」holder
// ------------------------------------------------------------
const { holder } = vi.hoisted(() => ({
  holder: { current: null as unknown },
}));

// 接管工厂：getDataProvider 始终返回 holder.current；reset 清空 holder
vi.mock("@/lib/data-access/factory", () => ({
  getDataProvider: () => holder.current,
  __resetDataProviderForTests: () => {
    holder.current = null;
  },
}));

// 真实 MockProvider（未被 mock），用于成功 / 404 等真实分支
import { MockProvider } from "@/lib/data-access/mock/mock-provider";
import { __resetDataProviderForTests } from "@/lib/data-access/factory";

// ------------------------------------------------------------
// 2) 导入各 Route Handler 函数（按路由别名区分同名导出）
// ------------------------------------------------------------
import { GET as devicesGET } from "@/app/api/devices/route";
import { GET as deviceDetailGET } from "@/app/api/devices/[id]/route";
import { GET as accountGET, PUT as accountPUT } from "@/app/api/account/route";
import { GET as energySummaryGET } from "@/app/api/energy/summary/route";
import { GET as energyWeeklyGET } from "@/app/api/energy/weekly/route";
import {
  GET as strategiesGET,
  POST as strategiesPOST,
} from "@/app/api/trading/strategies/route";
import {
  PUT as strategyPUT,
  DELETE as strategyDELETE,
} from "@/app/api/trading/strategies/[id]/route";
import { GET as marketGET } from "@/app/api/trading/market/route";

// ------------------------------------------------------------
// 3) 固定 seed 与时钟，保证真实 MockProvider 的初始数据确定可复现
// ------------------------------------------------------------
const FIXED_SEED = 0x1234;
const FIXED_NOW = Date.parse("2024-06-15T12:00:00.000Z");

/** 注入真实 MockProvider 作为当前数据提供者，并返回该实例以便读取真实 id。 */
function useRealProvider(): MockProvider {
  const provider = new MockProvider({ seed: FIXED_SEED, clock: () => FIXED_NOW });
  holder.current = provider;
  return provider;
}

/**
 * 注入一个受控 Fake 提供者：仅需定义被测端点会调用的方法。
 * 用于产出 MockProvider 不会自然返回的分支（如 TIMEOUT / PROVIDER_ERROR / 抛异常）。
 */
function useFakeProvider(overrides: Partial<Record<keyof IDataProvider, unknown>>): void {
  holder.current = overrides as unknown;
}

// ------------------------------------------------------------
// 4) 请求构造工具
// ------------------------------------------------------------

/** 构造携带 JSON 文本 body 的标准 Request（可传入畸形 JSON 文本）。 */
function jsonRequest(url: string, method: string, bodyText: string): Request {
  return new Request(url, {
    method,
    body: bodyText,
    headers: { "content-type": "application/json" },
  });
}

/** 一个字段合法的账户输入（用于成功路径）。 */
const VALID_ACCOUNT: AccountProfileInput = {
  name: "张三",
  email: "zhangsan@example.com",
  phone: "+86 138-0000-0000",
  address: "北京市朝阳区某街道 1 号",
};

// ------------------------------------------------------------
// 5) 断言工具：成功 / 失败响应的信封形状
// ------------------------------------------------------------

/** 断言成功响应信封：含 data，不含 error。 */
function expectSuccessEnvelope(body: unknown): asserts body is { data: unknown } {
  expect(typeof body).toBe("object");
  expect(body).not.toBeNull();
  const obj = body as Record<string, unknown>;
  expect("data" in obj).toBe(true);
  expect("error" in obj).toBe(false);
}

/**
 * 断言失败响应信封（需求 5.4、5.6）：
 *   - 顶层「只」含 error，不含 data（无部分数据）；
 *   - error 只含 type/message/field 三种键，type 匹配期望且 message 非空；
 *   - 整个 body 不含任何栈信息（"stack"）。
 */
function expectErrorEnvelope(
  body: unknown,
  expectedType: DataErrorType,
  expectedField?: string
): void {
  expect(typeof body).toBe("object");
  expect(body).not.toBeNull();
  const obj = body as Record<string, unknown>;

  // 顶层仅含 error，不携带任何业务数据
  expect(Object.keys(obj)).toEqual(["error"]);
  expect("data" in obj).toBe(false);

  const error = obj.error as Record<string, unknown>;
  // error 的键集合必须是 {type, message, field} 的子集
  const allowed = new Set(["type", "message", "field"]);
  for (const key of Object.keys(error)) {
    expect(allowed.has(key)).toBe(true);
  }
  // 绝不泄漏栈信息
  expect("stack" in error).toBe(false);

  expect(error.type).toBe(expectedType);
  expect(typeof error.message).toBe("string");
  expect((error.message as string).length).toBeGreaterThan(0);

  if (expectedField !== undefined) {
    expect(error.field).toBe(expectedField);
  }

  // 整个序列化结果不含 "stack"，进一步保证无栈信息泄漏
  expect(JSON.stringify(body).toLowerCase()).not.toContain("stack");
}

// 每个用例前重置当前提供者，保证用例间隔离
beforeEach(() => {
  __resetDataProviderForTests();
  holder.current = null;
});

// ============================================================
// 设备：列表 / 详情
// ============================================================
describe("设备 API 路由", () => {
  it("GET /api/devices 成功返回 200 + { data: Device[] }", async () => {
    useRealProvider();
    const res = await devicesGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(Array.isArray((body as { data: unknown }).data)).toBe(true);
  });

  it("GET /api/devices/[id] 成功返回 200 + 设备详情", async () => {
    const provider = useRealProvider();
    const list = await provider.listDevices();
    if (!list.ok) throw new Error("种子设备列表应当成功");
    const id = list.data[0].id;

    const res = await deviceDetailGET(new Request(`http://localhost/api/devices/${id}`), {
      params: { id },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("GET /api/devices/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await deviceDetailGET(
      new Request("http://localhost/api/devices/does-not-exist"),
      { params: { id: "does-not-exist" } }
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("GET /api/devices 提供者返回 PROVIDER_ERROR 映射为 500", async () => {
    useFakeProvider({
      listDevices: () =>
        Promise.resolve({
          ok: false,
          error: { type: "PROVIDER_ERROR", message: "数据来源内部错误" },
        }),
    });
    const res = await devicesGET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });

  it("GET /api/devices 提供者抛出异常时兜底为 500 且不泄漏栈信息", async () => {
    useFakeProvider({
      listDevices: () => Promise.reject(new Error("boom\n  at stackframe (file.ts:1:1)")),
    });
    const res = await devicesGET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });
});

// ============================================================
// 账户：GET / PUT
// ============================================================
describe("账户 API 路由", () => {
  it("GET /api/account 成功返回 200 + 账户资料", async () => {
    useRealProvider();
    const res = await accountGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(typeof (body as { data: { name: string } }).data.name).toBe("string");
  });

  it("PUT /api/account 合法输入返回 200 + 最新资料", async () => {
    useRealProvider();
    const res = await accountPUT(
      jsonRequest("http://localhost/api/account", "PUT", JSON.stringify(VALID_ACCOUNT))
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: AccountProfileInput }).data.email).toBe(VALID_ACCOUNT.email);
  });

  it("PUT /api/account 非法字段返回 400 VALIDATION 且携带 field", async () => {
    useRealProvider();
    // 姓名合法、邮箱非法 -> 首个出错字段为 email
    const invalid: AccountProfileInput = { ...VALID_ACCOUNT, email: "not-an-email" };
    const res = await accountPUT(
      jsonRequest("http://localhost/api/account", "PUT", JSON.stringify(invalid))
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "email");
  });

  it("PUT /api/account 畸形 JSON 报文返回 400 VALIDATION", async () => {
    useRealProvider();
    const res = await accountPUT(
      jsonRequest("http://localhost/api/account", "PUT", "{ this is not valid json")
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION");
  });

  it("GET /api/account 提供者返回 TIMEOUT 映射为 504", async () => {
    useFakeProvider({
      getAccountProfile: () =>
        Promise.resolve({
          ok: false,
          error: { type: "TIMEOUT", message: "数据来源超时" },
        }),
    });
    const res = await accountGET();
    const body = await res.json();
    expect(res.status).toBe(504);
    expectErrorEnvelope(body, "TIMEOUT");
  });

  it("PUT /api/account 提供者抛异常兜底为 500", async () => {
    useFakeProvider({
      updateAccountProfile: () => Promise.reject(new Error("unexpected")),
    });
    const res = await accountPUT(
      jsonRequest("http://localhost/api/account", "PUT", JSON.stringify(VALID_ACCOUNT))
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });
});

// ============================================================
// 充放电：当日总量 / 7 天数据
// ============================================================
describe("充放电 API 路由", () => {
  it("GET /api/energy/summary 成功返回 200 + 当日总量", async () => {
    useRealProvider();
    const res = await energySummaryGET(
      new NextRequest("http://localhost/api/energy/summary")
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    const data = (body as { data: { totalChargeKwh: number } }).data;
    expect(typeof data.totalChargeKwh).toBe("number");
  });

  it("GET /api/energy/summary 未知 deviceId 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await energySummaryGET(
      new NextRequest("http://localhost/api/energy/summary?deviceId=ghost")
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("GET /api/energy/weekly 成功返回 200 + 恰好 7 条记录", async () => {
    useRealProvider();
    const res = await energyWeeklyGET(
      new NextRequest("http://localhost/api/energy/weekly")
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: unknown[] }).data).toHaveLength(7);
  });

  it("GET /api/energy/weekly 未知 deviceId 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await energyWeeklyGET(
      new NextRequest("http://localhost/api/energy/weekly?deviceId=ghost")
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });
});

// ============================================================
// 电力交易：策略列表/创建、单策略更新/删除、市场状态
// ============================================================
describe("电力交易 API 路由", () => {
  it("GET /api/trading/strategies 成功返回 200 + 策略列表", async () => {
    useRealProvider();
    const res = await strategiesGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(Array.isArray((body as { data: unknown }).data)).toBe(true);
  });

  it("POST /api/trading/strategies 合法输入创建成功返回 201", async () => {
    useRealProvider();
    const res = await strategiesPOST(
      jsonRequest(
        "http://localhost/api/trading/strategies",
        "POST",
        JSON.stringify({
          name: "测试策略",
          action: "charge",
          condition: { comparator: "greater_than", priceThreshold: 1.5 },
          enabled: true,
        })
      )
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expectSuccessEnvelope(body);
    expect(typeof (body as { data: { id: string } }).data.id).toBe("string");
  });

  it("POST /api/trading/strategies 非法输入返回 400 VALIDATION 且携带 field", async () => {
    useRealProvider();
    const res = await strategiesPOST(
      jsonRequest(
        "http://localhost/api/trading/strategies",
        "POST",
        JSON.stringify({
          name: "", // 名称为空 -> field "name"
          action: "charge",
          condition: { comparator: "greater_than", priceThreshold: 1 },
          enabled: true,
        })
      )
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "name");
  });

  it("POST /api/trading/strategies 畸形 JSON 返回 400 VALIDATION", async () => {
    useRealProvider();
    const res = await strategiesPOST(
      jsonRequest("http://localhost/api/trading/strategies", "POST", "}{ not json")
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION");
  });

  it("PUT /api/trading/strategies/[id] 启停现有策略返回 200", async () => {
    const provider = useRealProvider();
    const list = await provider.listStrategies();
    if (!list.ok || list.data.length === 0) throw new Error("种子策略应当存在");
    const id = list.data[0].id;

    const res = await strategyPUT(
      jsonRequest(
        `http://localhost/api/trading/strategies/${id}`,
        "PUT",
        JSON.stringify({ enabled: true })
      ),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("PUT /api/trading/strategies/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await strategyPUT(
      jsonRequest(
        "http://localhost/api/trading/strategies/ghost",
        "PUT",
        JSON.stringify({ enabled: true })
      ),
      { params: { id: "ghost" } }
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("DELETE /api/trading/strategies/[id] 删除现有策略返回 200", async () => {
    const provider = useRealProvider();
    const list = await provider.listStrategies();
    if (!list.ok || list.data.length === 0) throw new Error("种子策略应当存在");
    const id = list.data[0].id;

    const res = await strategyDELETE(
      new Request(`http://localhost/api/trading/strategies/${id}`, { method: "DELETE" }),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("DELETE /api/trading/strategies/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await strategyDELETE(
      new Request("http://localhost/api/trading/strategies/ghost", { method: "DELETE" }),
      { params: { id: "ghost" } }
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("GET /api/trading/market 成功返回 200 + 电价与历史", async () => {
    useRealProvider();
    const res = await marketGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    const data = (body as { data: { currentPrice: number; history: unknown[] } }).data;
    expect(typeof data.currentPrice).toBe("number");
    expect(Array.isArray(data.history)).toBe(true);
  });

  it("GET /api/trading/market 提供者返回 TIMEOUT 映射为 504", async () => {
    useFakeProvider({
      getMarketState: () =>
        Promise.resolve({
          ok: false,
          error: { type: "TIMEOUT", message: "市场数据超时" },
        }),
    });
    const res = await marketGET();
    const body = await res.json();
    expect(res.status).toBe(504);
    expectErrorEnvelope(body, "TIMEOUT");
  });
});
