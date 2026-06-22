// 账户信息管理组件测试（任务 21.22，需求 2.1、2.2、2.3、2.4、2.5、2.6、2.7、2.10、2.11、2.12、2.14）
//
// 覆盖多账户模型下的账户管理四组件：
//   - AccountListPanel：账户列表 + Current_Account 选中态、空状态、选择回调（需求 2.1、2.2、2.3）。
//   - CreateAccountForm：创建成功提示、达上限（5）禁用并提示、服务端 ACCOUNT_LIMIT 提示（需求 2.4、2.5、2.10）。
//   - EditAccountForm：预填空字段渲染为空、保存成功展示最新资料、校验失败保留输入（需求 2.3、2.6、2.7、2.14）。
//   - DeleteAccountButton：确认后删除并回调、LAST_ACCOUNT 提示、取消确认不删除（需求 2.11、2.12、2.14）。
//
// 这些组件均为 props 驱动，不直接消费 AccountContext，故可独立渲染测试。
// 通过 vi.mock 模拟 HTTP 客户端（@/lib/http/client）的 getJson / sendJson，
// 通过 vi.spyOn(window, "confirm") 控制删除确认。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, AccountProfile, Result } from "@/lib/data-access/types";

// —— 模拟 HTTP 客户端：仅替换组件实际使用的 getJson / sendJson ——
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

import { getJson, sendJson } from "@/lib/http/client";
import AccountListPanel from "@/components/account/account-list-panel";
import CreateAccountForm from "@/components/account/create-account-form";
import EditAccountForm from "@/components/account/edit-account-form";
import DeleteAccountButton from "@/components/account/delete-account-button";

const mockGetJson = vi.mocked(getJson);
const mockSendJson = vi.mocked(sendJson);

/** 构造成功结果信封 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 构造一个账户实体夹具 */
function makeAccount(id: string, name: string): Account {
  return {
    id,
    profile: {
      name,
      email: `${id}@example.com`,
      phone: "+86 138-0000-0000",
      address: "北京市朝阳区",
    },
  };
}

beforeEach(() => {
  mockGetJson.mockReset();
  mockSendJson.mockReset();
});

// ============================================================
// AccountListPanel：列表 + 选中态 + 空状态 + 选择（需求 2.1、2.2、2.3）
// ============================================================
describe("AccountListPanel 账户列表（需求 2.1、2.2、2.3）", () => {
  it("渲染全部账户的姓名与唯一标识，并对 Current_Account 呈现选中态", () => {
    const accounts = [makeAccount("account-001", "张三"), makeAccount("account-002", "李四")];
    render(
      <AccountListPanel
        accounts={accounts}
        currentAccountId="account-002"
        onSelect={vi.fn()}
      />
    );

    // 两个账户姓名与 id 均渲染
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.getByText("account-001")).toBeInTheDocument();
    expect(screen.getByText("account-002")).toBeInTheDocument();

    // Current_Account（account-002）呈现选中态：aria-selected=true + 文本徽章「当前」
    const selectedOption = screen.getByRole("option", { selected: true });
    expect(within(selectedOption).getByText("李四")).toBeInTheDocument();
    expect(within(selectedOption).getByText("当前")).toBeInTheDocument();
  });

  it("点击账户项触发 onSelect 回调并携带其 id（需求 2.3）", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const accounts = [makeAccount("account-001", "张三"), makeAccount("account-002", "李四")];
    render(
      <AccountListPanel
        accounts={accounts}
        currentAccountId="account-001"
        onSelect={onSelect}
      />
    );

    await user.click(screen.getByRole("option", { name: /李四/ }));
    expect(onSelect).toHaveBeenCalledWith("account-002");
  });

  it("无账户时显示「暂无账户」空状态（需求 2.2）", () => {
    render(
      <AccountListPanel accounts={[]} currentAccountId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText("暂无账户")).toBeInTheDocument();
  });
});

// ============================================================
// CreateAccountForm：创建成功 / 上限禁用 / 服务端上限提示（需求 2.4、2.5、2.10）
// ============================================================
describe("CreateAccountForm 创建账户（需求 2.4、2.5、2.10）", () => {
  it("未达上限时填写并提交，POST /api/accounts 成功后提示成功并回调 onCreated（需求 2.4、2.10）", async () => {
    const user = userEvent.setup();
    const created = makeAccount("account-003", "王五");
    mockSendJson.mockResolvedValue(ok(created));
    const onCreated = vi.fn();

    render(<CreateAccountForm accountCount={2} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("姓名"), "王五");
    await user.type(screen.getByLabelText("邮箱"), "wangwu@example.com");
    await user.type(screen.getByLabelText("电话"), "13800138000");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    // 经 POST /api/accounts 提交账户资料
    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/accounts",
        "POST",
        expect.objectContaining({ name: "王五", email: "wangwu@example.com" })
      );
    });

    // 成功提示出现且通知父级
    expect(await screen.findByText("账户创建成功")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("账户数已达上限 5 时禁用提交并提示「账户数量已达上限 5 个」（需求 2.5）", () => {
    render(<CreateAccountForm accountCount={5} onCreated={vi.fn()} />);

    expect(screen.getByText("账户数量已达上限 5 个")).toBeInTheDocument();
    // 提交按钮禁用
    expect(screen.getByRole("button", { name: "创建账户" })).toBeDisabled();
  });

  it("服务端返回 ACCOUNT_LIMIT 时展示上限错误提示（需求 2.5）", async () => {
    const user = userEvent.setup();
    // accountCount 仍 < 5（前端不禁用），但服务端拒绝并返回 ACCOUNT_LIMIT
    mockSendJson.mockResolvedValue({
      ok: false,
      error: { type: "ACCOUNT_LIMIT", message: "账户数量已达上限 5 个" },
    });

    render(<CreateAccountForm accountCount={4} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("姓名"), "赵六");
    await user.type(screen.getByLabelText("邮箱"), "zhaoliu@example.com");
    await user.type(screen.getByLabelText("电话"), "13800138001");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    expect(await screen.findByText("账户数量已达上限 5 个")).toBeInTheDocument();
  });
});

// ============================================================
// EditAccountForm：预填空字段 / 保存成功 / 校验失败保留输入（需求 2.3、2.6、2.7、2.14）
// ============================================================
describe("EditAccountForm 编辑账户（需求 2.3、2.6、2.7、2.14）", () => {
  it("预填时空字段渲染为空（需求 2.3）", async () => {
    // 地址留空，用于验证空字段渲染为空
    const account: Account = {
      id: "account-001",
      profile: {
        name: "张三",
        email: "zhangsan@example.com",
        phone: "13800138000",
        address: "",
      },
    };
    mockGetJson.mockResolvedValue(ok(account));

    render(<EditAccountForm accountId="account-001" onUpdated={vi.fn()} />);

    const nameInput = await screen.findByLabelText<HTMLInputElement>("姓名");
    expect(nameInput).toHaveValue("张三");
    expect(screen.getByLabelText<HTMLInputElement>("邮箱")).toHaveValue(
      "zhangsan@example.com"
    );
    // 空字段（地址）渲染为空字符串
    expect(screen.getByLabelText<HTMLTextAreaElement>("地址")).toHaveValue("");

    // 据账户 id 经 GET /api/accounts/{id} 拉取预填数据
    expect(mockGetJson).toHaveBeenCalledWith("/api/accounts/account-001");
  });

  it("保存成功时显示成功提示并展示最新资料（需求 2.6、2.10）", async () => {
    const initial = makeAccount("account-001", "张三");
    const latest: Account = {
      id: "account-001",
      profile: {
        name: "李四",
        email: "lisi@example.com",
        phone: "13900139000",
        address: "上海市浦东新区",
      },
    };
    mockGetJson.mockResolvedValue(ok(initial));
    mockSendJson.mockResolvedValue(ok(latest));
    const onUpdated = vi.fn();

    const user = userEvent.setup();
    render(<EditAccountForm accountId="account-001" onUpdated={onUpdated} />);

    const nameInput = await screen.findByLabelText<HTMLInputElement>("姓名");
    await user.clear(nameInput);
    await user.type(nameInput, "李四");
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 成功提示出现（需求 2.6）
    await waitFor(() => {
      expect(screen.getByText("账户资料已成功保存")).toBeInTheDocument();
    });

    // 在成功提示区域内展示服务端返回的最新资料（需求 2.6）
    const successRegion = screen.getByRole("status");
    expect(within(successRegion).getByText("李四")).toBeInTheDocument();
    expect(within(successRegion).getByText("lisi@example.com")).toBeInTheDocument();

    // 经 PUT /api/accounts/{id} 提交更新
    expect(mockSendJson).toHaveBeenCalledWith(
      "/api/accounts/account-001",
      "PUT",
      expect.objectContaining({ name: "李四" })
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("校验失败时在对应字段旁显示错误并保留用户输入（需求 2.7、2.14）", async () => {
    const initial = makeAccount("account-001", "张三");
    mockGetJson.mockResolvedValue(ok(initial));
    // 服务端返回 VALIDATION，field=email
    mockSendJson.mockResolvedValue({
      ok: false,
      error: { type: "VALIDATION", message: "邮箱格式不正确", field: "email" },
    });

    const user = userEvent.setup();
    render(<EditAccountForm accountId="account-001" onUpdated={vi.fn()} />);

    const emailInput = await screen.findByLabelText<HTMLInputElement>("邮箱");
    await user.clear(emailInput);
    await user.type(emailInput, "bad-email");
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 字段错误信息出现
    const fieldError = await screen.findByRole("alert");
    expect(fieldError).toHaveTextContent("邮箱格式不正确");

    // 错误展示在邮箱字段旁：aria-invalid + aria-describedby 关联
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput.getAttribute("aria-describedby")).toBe(fieldError.id);

    // 用户输入被保留，不因校验失败清空（需求 2.14）
    expect(emailInput).toHaveValue("bad-email");
    // 成功提示不应出现
    expect(screen.queryByText("账户资料已成功保存")).not.toBeInTheDocument();
  });
});

// ============================================================
// DeleteAccountButton：确认删除 / LAST_ACCOUNT 提示 / 取消（需求 2.11、2.12、2.14）
// ============================================================
describe("DeleteAccountButton 删除账户（需求 2.11、2.12、2.14）", () => {
  it("确认后经 DELETE /api/accounts/{id} 删除并回调 onDeleted（需求 2.11）", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockSendJson.mockResolvedValue(
      ok({ id: "account-002", remainingAccountIds: ["account-001"] })
    );
    const onDeleted = vi.fn();

    render(<DeleteAccountButton accountId="account-002" onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "删除账户" }));

    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/accounts/account-002",
        "DELETE"
      );
    });
    expect(onDeleted).toHaveBeenCalledWith({
      id: "account-002",
      remainingAccountIds: ["account-001"],
    });

    confirmSpy.mockRestore();
  });

  it("服务端返回 LAST_ACCOUNT 时提示「至少需保留 1 个账户」（需求 2.12）", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockSendJson.mockResolvedValue({
      ok: false,
      error: { type: "LAST_ACCOUNT", message: "至少需保留 1 个账户" },
    });

    render(<DeleteAccountButton accountId="account-001" onDeleted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "删除账户" }));

    expect(await screen.findByText("至少需保留 1 个账户")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("取消确认时不发起删除请求（需求 2.11）", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeleted = vi.fn();

    render(<DeleteAccountButton accountId="account-002" onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "删除账户" }));

    expect(mockSendJson).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
