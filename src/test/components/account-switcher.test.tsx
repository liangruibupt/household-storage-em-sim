// 账户切换器与账户上下文数据刷新/隔离测试（任务 21.22，需求 2.13、6.4、6.5、6.6）
//
// 覆盖：
//   - AccountSwitcher 展示账户列表（≤5）并标记 Current_Account（需求 6.4）。
//   - 切换 Current_Account 后，消费页面（DevicesPage）在 3 秒内重新拉取该账户名下数据，
//     且不同账户的数据相互隔离（需求 6.5、6.6）。
//   - 删除 Current_Account 后刷新账户列表时自动切换到剩余账户之一（需求 2.13）。
//
// 通过真实 AccountProvider 提供上下文；仅 mock HTTP 客户端 getJson，
// 由 accountId 选项路由到不同账户的受控数据，从而验证作用域隔离与刷新。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Account, Device, Result } from "@/lib/data-access/types";

// mock 前端 HTTP 客户端：AccountProvider 与各页面均经 getJson 访问 API
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "@/lib/http/client";
import { AccountProvider, useAccount } from "@/components/account/account-context";
import AccountSwitcher from "@/components/nav/account-switcher";
import DevicesPage from "@/app/devices/page";

const mockGetJson = vi.mocked(getJson);

/** 构造成功结果信封 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 构造账户实体夹具 */
function makeAccount(id: string, name: string): Account {
  return {
    id,
    profile: {
      name,
      email: `${id}@example.com`,
      phone: "+86 138-0000-0000",
      address: "示例地址",
    },
  };
}

/** 构造归属指定账户的设备夹具 */
function makeDevice(id: string, name: string, accountId: string): Device {
  return {
    id,
    accountId,
    name,
    connectionStatus: "online",
    lastReportedAt: "2024-06-15T12:00:00.000Z",
  };
}

const ACCOUNT_A = makeAccount("account-001", "账户A");
const ACCOUNT_B = makeAccount("account-002", "账户B");

beforeEach(() => {
  mockGetJson.mockReset();
});

describe("AccountSwitcher 账户切换器（需求 6.4）", () => {
  it("展示账户列表并以下拉值标记 Current_Account（默认首个账户）", async () => {
    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/accounts") return ok([ACCOUNT_A, ACCOUNT_B]);
      return ok(null);
    });

    render(
      <AccountProvider>
        <AccountSwitcher />
      </AccountProvider>
    );

    // 账户加载完成后出现切换下拉
    const select = await screen.findByLabelText<HTMLSelectElement>("选择当前账户");
    // 两个账户名均作为选项呈现
    expect(screen.getByRole("option", { name: "账户A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "账户B" })).toBeInTheDocument();
    // 默认选中首个账户（Current_Account = account-001）
    expect(select.value).toBe("account-001");
  });
});

describe("切换账户后数据刷新与隔离（需求 6.5、6.6）", () => {
  it("切换 Current_Account 后设备页在 3 秒内重新拉取该账户数据，且跨账户隔离", async () => {
    // 按 accountId 返回不同账户名下的设备，验证作用域隔离
    mockGetJson.mockImplementation(
      async (url: string, options?: { accountId?: string }) => {
        if (url === "/api/accounts") return ok([ACCOUNT_A, ACCOUNT_B]);
        if (url === "/api/devices") {
          const accountId = options?.accountId;
          if (accountId === "account-001") {
            return ok([makeDevice("dev-a", "甲设备", "account-001")]);
          }
          if (accountId === "account-002") {
            return ok([makeDevice("dev-b", "乙设备", "account-002")]);
          }
          return ok([]);
        }
        return ok(null);
      }
    );

    render(
      <AccountProvider>
        <AccountSwitcher />
        <DevicesPage />
      </AccountProvider>
    );

    // 初始 Current_Account = account-001：设备页展示账户A 名下「甲设备」
    expect(await screen.findByText("甲设备")).toBeInTheDocument();
    expect(screen.queryByText("乙设备")).not.toBeInTheDocument();

    // 经切换器切换到账户B
    const select = await screen.findByLabelText<HTMLSelectElement>("选择当前账户");
    fireEvent.change(select, { target: { value: "account-002" } });

    // 3 秒内重新拉取并展示账户B 名下「乙设备」，账户A 数据不再出现（隔离）
    await waitFor(() => {
      expect(screen.getByText("乙设备")).toBeInTheDocument();
    });
    expect(screen.queryByText("甲设备")).not.toBeInTheDocument();

    // 设备列表请求确实携带切换后的 accountId 作用域
    expect(
      mockGetJson.mock.calls.some(
        ([url, opts]) =>
          url === "/api/devices" &&
          (opts as { accountId?: string } | undefined)?.accountId === "account-002"
      )
    ).toBe(true);
  });
});

describe("删除 Current_Account 后自动切换（需求 2.13）", () => {
  /** 暴露 currentAccountId 与 refreshAccounts 的测试探针组件 */
  function Probe(): JSX.Element {
    const { currentAccountId, refreshAccounts } = useAccount();
    return (
      <div>
        <span data-testid="current">{currentAccountId ?? "none"}</span>
        <button type="button" onClick={() => void refreshAccounts()}>
          刷新账户
        </button>
      </div>
    );
  }

  it("刷新后原 Current_Account 已不在列表时，自动选定剩余账户之一", async () => {
    // 初始返回 [A, B]，Current_Account 默认 account-001
    let accountList: Account[] = [ACCOUNT_A, ACCOUNT_B];
    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/accounts") return ok(accountList);
      return ok(null);
    });

    render(
      <AccountProvider>
        <Probe />
      </AccountProvider>
    );

    // 初始自动选定首个账户 account-001
    await waitFor(() => {
      expect(screen.getByTestId("current")).toHaveTextContent("account-001");
    });

    // 模拟删除 account-001：刷新时列表仅剩 account-002
    accountList = [ACCOUNT_B];
    fireEvent.click(screen.getByRole("button", { name: "刷新账户" }));

    // 原 Current_Account（account-001）已不存在 → 自动切换到剩余账户 account-002
    await waitFor(() => {
      expect(screen.getByTestId("current")).toHaveTextContent("account-002");
    });
  });
});
