// API 路由集成测试（多账户，需求 2.4、2.5、2.11、2.12、5.4、5.6、6.5）
//
// 目标：直接导入各 Route Handler 函数并以构造的 Request/NextRequest 调用，
// 断言其将数据访问层返回的 Result<T> 正确映射为 HTTP 响应：
//   成功            -> 200（创建用 201），body 形如 { data }
//   VALIDATION      -> 400（并携带出错 field），body 形如 { error: { type, message, field? } }
//   NOT_FOUND       -> 404
//   ACCOUNT_LIMIT   -> 409（账户数已达上限 5）
//   LAST_ACCOUNT    -> 409（至少需保留 1 个账户）
//   TIMEOUT         -> 504
//   PROVIDER_ERROR  -> 500（含意外异常兜底）
//
// 多账户作用域：设备/充放电/交易三大功能区路由均要求查询参数 accountId（需求 6.5）；
// 缺失/空 accountId 由路由层映射为 400（VALIDATION）。账户管理改为 /api/accounts 集合
// 与 /api/accounts/[id] 单资源路由（需求 2.x）。
//
// 关键断言（需求 5.4、5.6）：
//   - 失败响应「只」包含 { error: { type, message, field? } }，不含 data（无部分数据）。
//   - 失败响应不泄漏任何栈信息（不含 "stack"）。
//
// 测试策略：
//   通过 vi.mock 接管 `@/lib/data-access/factory` 的 getDataProvider()，
//   使其返回一个可切换的「当前提供者」holder.current：
//     - 成功 / 404 等真实分支：注入真实 MockProvider（固定 seed 与时钟，确定可复现）；
//     - 500 / 504 / 抛异常等无法由 MockProvider 自然产出的分支：注入受控 Fake 提供者。

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
import {
  GET as accountsGET,
  POST as accountsPOST,
} from "@/app/api/accounts/route";
import {
  GET as accountGET,
  PUT as accountPUT,
  DELETE as accountDELETE,
} from "@/app/api/accounts/[id]/route";
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
function useRealProvider(accountCount = 2): MockProvider {
  const provider = new MockProvider({
    seed: FIXED_SEED,
    clock: () => FIXED_NOW,
    accountCount,
  });
  holder.current = provider;
  return provider;
}

/**
 * 注入一个受控 Fake 提供者：仅需定义被测端点会调用的方法。
 * 用于产出 MockProvider 不会自然返回的分支（如 TIMEOUT / PROVIDER_ERROR / 抛异常）。
 */
function useFakeProvider(
  overrides: Partial<Record<keyof IDataProvider, unknown>>
): void {
  holder.current = overrides as unknown;
}

/** 读取真实 MockProvider 的首个账户 id（种子账户应当存在）。 */
async function firstAccountId(provider: MockProvider): Promise<string> {
  const result = await provider.listAccounts();
  if (!result.ok || result.data.length === 0) {
    throw new Error("种子账户应当存在");
  }
  return result.data[0].id;
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
// 账户集合：GET 列表 / POST 创建
// ============================================================
describe("账户集合 API 路由 (/api/accounts)", () => {
  it("GET /api/accounts 成功返回 200 + { data: Account[] }", async () => {
    useRealProvider();
    const res = await accountsGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(Array.isArray((body as { data: unknown }).data)).toBe(true);
  });

  it("POST /api/accounts 合法输入创建成功返回 201 + 新账户", async () => {
    useRealProvider();
    const res = await accountsPOST(
      jsonRequest("http://localhost/api/accounts", "POST", JSON.stringify(VALID_ACCOUNT))
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expectSuccessEnvelope(body);
    expect((body as { data: { profile: AccountProfileInput } }).data.profile.email).toBe(
      VALID_ACCOUNT.email
    );
  });

  it("POST /api/accounts 非法字段返回 400 VALIDATION 且携带 field", async () => {
    useRealProvider();
    // 姓名合法、邮箱非法 -> 首个出错字段为 email
    const invalid: AccountProfileInput = { ...VALID_ACCOUNT, email: "not-an-email" };
    const res = await accountsPOST(
      jsonRequest("http://localhost/api/accounts", "POST", JSON.stringify(invalid))
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "email");
  });

  it("POST /api/accounts 畸形 JSON 报文返回 400 VALIDATION", async () => {
    useRealProvider();
    const res = await accountsPOST(
      jsonRequest("http://localhost/api/accounts", "POST", "{ this is not valid json")
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION");
  });

  it("POST /api/accounts 账户数已达 5 时返回 409 ACCOUNT_LIMIT", async () => {
    // 真实 MockProvider 种子化 5 个账户（达上限），再创建必被拒（需求 2.5、6.4）
    useRealProvider(5);
    const res = await accountsPOST(
      jsonRequest("http://localhost/api/accounts", "POST", JSON.stringify(VALID_ACCOUNT))
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expectErrorEnvelope(body, "ACCOUNT_LIMIT");
  });

  it("GET /api/accounts 提供者返回 TIMEOUT 映射为 504", async () => {
    useFakeProvider({
      listAccounts: () =>
        Promise.resolve({
          ok: false,
          error: { type: "TIMEOUT", message: "数据来源超时" },
        }),
    });
    const res = await accountsGET();
    const body = await res.json();
    expect(res.status).toBe(504);
    expectErrorEnvelope(body, "TIMEOUT");
  });

  it("POST /api/accounts 提供者抛异常兜底为 500", async () => {
    useFakeProvider({
      createAccount: () => Promise.reject(new Error("unexpected")),
    });
    const res = await accountsPOST(
      jsonRequest("http://localhost/api/accounts", "POST", JSON.stringify(VALID_ACCOUNT))
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });
});

// ============================================================
// 单个账户：GET / PUT / DELETE
// ============================================================
describe("单个账户 API 路由 (/api/accounts/[id])", () => {
  it("GET /api/accounts/[id] 成功返回 200 + 账户详情", async () => {
    const provider = useRealProvider();
    const id = await firstAccountId(provider);
    const res = await accountGET(
      new Request(`http://localhost/api/accounts/${id}`),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("GET /api/accounts/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    useRealProvider();
    const res = await accountGET(
      new Request("http://localhost/api/accounts/does-not-exist"),
      { params: { id: "does-not-exist" } }
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("PUT /api/accounts/[id] 合法输入返回 200 + 最新资料", async () => {
    const provider = useRealProvider();
    const id = await firstAccountId(provider);
    const res = await accountPUT(
      jsonRequest(`http://localhost/api/accounts/${id}`, "PUT", JSON.stringify(VALID_ACCOUNT)),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { profile: AccountProfileInput } }).data.profile.email).toBe(
      VALID_ACCOUNT.email
    );
  });

  it("PUT /api/accounts/[id] 非法字段返回 400 VALIDATION 且携带 field", async () => {
    const provider = useRealProvider();
    const id = await firstAccountId(provider);
    const invalid: AccountProfileInput = { ...VALID_ACCOUNT, email: "not-an-email" };
    const res = await accountPUT(
      jsonRequest(`http://localhost/api/accounts/${id}`, "PUT", JSON.stringify(invalid)),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "email");
  });

  it("DELETE /api/accounts/[id] 删除现有账户返回 200 + 剩余账户标识", async () => {
    const provider = useRealProvider();
    const id = await firstAccountId(provider);
    const res = await accountDELETE(
      new Request(`http://localhost/api/accounts/${id}`, { method: "DELETE" }),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    const data = (body as { data: { id: string; remainingAccountIds: string[] } }).data;
    expect(data.id).toBe(id);
    expect(Array.isArray(data.remainingAccountIds)).toBe(true);
    expect(data.remainingAccountIds).not.toContain(id);
  });

  it("DELETE /api/accounts/[id] 删除唯一账户返回 409 LAST_ACCOUNT", async () => {
    // 仅 1 个账户：删除被拒（需求 2.12）
    const provider = useRealProvider(1);
    const id = await firstAccountId(provider);
    const res = await accountDELETE(
      new Request(`http://localhost/api/accounts/${id}`, { method: "DELETE" }),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expectErrorEnvelope(body, "LAST_ACCOUNT");
  });

  it("PUT /api/accounts/[id] 提供者抛异常兜底为 500", async () => {
    useFakeProvider({
      updateAccountProfile: () => Promise.reject(new Error("unexpected")),
    });
    const res = await accountPUT(
      jsonRequest("http://localhost/api/accounts/account-001", "PUT", JSON.stringify(VALID_ACCOUNT)),
      { params: { id: "account-001" } }
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });
});

// ============================================================
// 设备：列表 / 详情（账户作用域）
// ============================================================
describe("设备 API 路由", () => {
  it("GET /api/devices?accountId 成功返回 200 + { data: Device[] }", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await devicesGET(
      new Request(`http://localhost/api/devices?accountId=${accountId}`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(Array.isArray((body as { data: unknown }).data)).toBe(true);
  });

  it("GET /api/devices 缺少 accountId 返回 400 VALIDATION", async () => {
    useRealProvider();
    const res = await devicesGET(new Request("http://localhost/api/devices"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "accountId");
  });

  it("GET /api/devices/[id]?accountId 成功返回 200 + 设备详情", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const list = await provider.listDevices(accountId);
    if (!list.ok) throw new Error("种子设备列表应当成功");
    const id = list.data[0].id;

    const res = await deviceDetailGET(
      new Request(`http://localhost/api/devices/${id}?accountId=${accountId}`),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("GET /api/devices/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await deviceDetailGET(
      new Request(`http://localhost/api/devices/does-not-exist?accountId=${accountId}`),
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
    const res = await devicesGET(
      new Request("http://localhost/api/devices?accountId=account-001")
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });

  it("GET /api/devices 提供者抛出异常时兜底为 500 且不泄漏栈信息", async () => {
    useFakeProvider({
      listDevices: () => Promise.reject(new Error("boom\n  at stackframe (file.ts:1:1)")),
    });
    const res = await devicesGET(
      new Request("http://localhost/api/devices?accountId=account-001")
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expectErrorEnvelope(body, "PROVIDER_ERROR");
  });
});

// ============================================================
// 充放电：当日总量 / 7 天数据（账户作用域）
// ============================================================
describe("充放电 API 路由", () => {
  it("GET /api/energy/summary?accountId 成功返回 200 + 当日总量", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await energySummaryGET(
      new NextRequest(`http://localhost/api/energy/summary?accountId=${accountId}`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    const data = (body as { data: { totalChargeKwh: number } }).data;
    expect(typeof data.totalChargeKwh).toBe("number");
  });

  it("GET /api/energy/summary 缺少 accountId 返回 400 VALIDATION", async () => {
    useRealProvider();
    const res = await energySummaryGET(
      new NextRequest("http://localhost/api/energy/summary")
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION", "accountId");
  });

  it("GET /api/energy/summary 未知 deviceId 返回 404 NOT_FOUND", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await energySummaryGET(
      new NextRequest(
        `http://localhost/api/energy/summary?accountId=${accountId}&deviceId=ghost`
      )
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("GET /api/energy/weekly?accountId 成功返回 200 + 恰好 7 条记录", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await energyWeeklyGET(
      new NextRequest(`http://localhost/api/energy/weekly?accountId=${accountId}`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: unknown[] }).data).toHaveLength(7);
  });

  it("GET /api/energy/weekly 未知 deviceId 返回 404 NOT_FOUND", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await energyWeeklyGET(
      new NextRequest(
        `http://localhost/api/energy/weekly?accountId=${accountId}&deviceId=ghost`
      )
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });
});

// ============================================================
// 电力交易：策略列表/创建、单策略更新/删除、市场状态（账户作用域）
// ============================================================
describe("电力交易 API 路由", () => {
  it("GET /api/trading/strategies?accountId 成功返回 200 + 策略列表", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategiesGET(
      new Request(`http://localhost/api/trading/strategies?accountId=${accountId}`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect(Array.isArray((body as { data: unknown }).data)).toBe(true);
  });

  it("POST /api/trading/strategies 合法输入创建成功返回 201", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategiesPOST(
      jsonRequest(
        `http://localhost/api/trading/strategies?accountId=${accountId}`,
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
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategiesPOST(
      jsonRequest(
        `http://localhost/api/trading/strategies?accountId=${accountId}`,
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
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategiesPOST(
      jsonRequest(
        `http://localhost/api/trading/strategies?accountId=${accountId}`,
        "POST",
        "}{ not json"
      )
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expectErrorEnvelope(body, "VALIDATION");
  });

  it("PUT /api/trading/strategies/[id] 启停现有策略返回 200", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const list = await provider.listStrategies(accountId);
    if (!list.ok || list.data.length === 0) throw new Error("种子策略应当存在");
    const id = list.data[0].id;

    const res = await strategyPUT(
      jsonRequest(
        `http://localhost/api/trading/strategies/${id}?accountId=${accountId}`,
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
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategyPUT(
      jsonRequest(
        `http://localhost/api/trading/strategies/ghost?accountId=${accountId}`,
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
    const accountId = await firstAccountId(provider);
    const list = await provider.listStrategies(accountId);
    if (!list.ok || list.data.length === 0) throw new Error("种子策略应当存在");
    const id = list.data[0].id;

    const res = await strategyDELETE(
      new Request(
        `http://localhost/api/trading/strategies/${id}?accountId=${accountId}`,
        { method: "DELETE" }
      ),
      { params: { id } }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expectSuccessEnvelope(body);
    expect((body as { data: { id: string } }).data.id).toBe(id);
  });

  it("DELETE /api/trading/strategies/[id] 未知 id 返回 404 NOT_FOUND", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await strategyDELETE(
      new Request(
        `http://localhost/api/trading/strategies/ghost?accountId=${accountId}`,
        { method: "DELETE" }
      ),
      { params: { id: "ghost" } }
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expectErrorEnvelope(body, "NOT_FOUND");
  });

  it("GET /api/trading/market?accountId 成功返回 200 + 电价与历史", async () => {
    const provider = useRealProvider();
    const accountId = await firstAccountId(provider);
    const res = await marketGET(
      new Request(`http://localhost/api/trading/market?accountId=${accountId}`)
    );
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
    const res = await marketGET(
      new Request("http://localhost/api/trading/market?accountId=account-001")
    );
    const body = await res.json();
    expect(res.status).toBe(504);
    expectErrorEnvelope(body, "TIMEOUT");
  });
});
