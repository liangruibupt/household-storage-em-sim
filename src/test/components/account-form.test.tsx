// 账户表单组件测试 AccountForm（任务 16.2，需求 2.1、2.6、2.7）
//
// 本测试覆盖账户表单的三类关键行为：
//   1. 预填时空字段渲染为空（需求 2.1）；
//   2. 保存成功时显示成功提示并展示最新资料（需求 2.6）；
//   3. 校验失败时在对应字段旁显示错误且保留用户输入（需求 2.7）。
//
// 通过 vi.mock 模拟 HTTP 客户端（@/lib/http/client）：
//   - getJson 返回预填资料（含一个空字段以验证空渲染）；
//   - sendJson 分别模拟「成功并返回最新资料」与「VALIDATION 校验失败」两种结果。
// 交互使用 @testing-library/user-event 输入与提交，异步断言使用 waitFor / findBy。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountProfile, Result } from "@/lib/data-access/types";

// ——模拟 HTTP 客户端：仅替换组件实际使用的 getJson / sendJson——
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

import AccountForm from "@/components/account/account-form";
import { getJson, sendJson } from "@/lib/http/client";

// 取得带类型的 mock 句柄，便于在每个用例中定制返回值
const mockGetJson = vi.mocked(getJson);
const mockSendJson = vi.mocked(sendJson);

/** 构造成功结果信封 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

beforeEach(() => {
  // 每个用例前清空 mock 调用记录与实现，避免相互污染
  mockGetJson.mockReset();
  mockSendJson.mockReset();
});

describe("AccountForm 组件", () => {
  it("预填时空字段渲染为空（需求 2.1）", async () => {
    // 预填资料：address 故意留空，用于验证空字段渲染为空
    const profile: AccountProfile = {
      name: "张三",
      email: "zhangsan@example.com",
      phone: "13800138000",
      address: "",
    };
    mockGetJson.mockResolvedValue(ok(profile));

    render(<AccountForm />);

    // 等待预填完成：姓名字段应被填入返回值
    const nameInput = await screen.findByLabelText<HTMLInputElement>("姓名");
    expect(nameInput).toHaveValue("张三");

    // 邮箱、电话被正常填充
    expect(screen.getByLabelText<HTMLInputElement>("邮箱")).toHaveValue(
      "zhangsan@example.com"
    );
    expect(screen.getByLabelText<HTMLInputElement>("电话")).toHaveValue(
      "13800138000"
    );

    // 关键断言：空字段（地址）渲染为空字符串（需求 2.1）
    expect(screen.getByLabelText<HTMLTextAreaElement>("地址")).toHaveValue("");

    // 确实通过约定的端点拉取了预填数据
    expect(mockGetJson).toHaveBeenCalledWith("/api/account");
  });

  it("保存成功时显示成功提示并展示最新资料（需求 2.6）", async () => {
    const initial: AccountProfile = {
      name: "张三",
      email: "zhangsan@example.com",
      phone: "13800138000",
      address: "北京市海淀区",
    };
    // 服务端保存后返回的「最新资料」（姓名已更新为李四）
    const latest: AccountProfile = {
      name: "李四",
      email: "lisi@example.com",
      phone: "13900139000",
      address: "上海市浦东新区",
    };
    mockGetJson.mockResolvedValue(ok(initial));
    mockSendJson.mockResolvedValue(ok(latest));

    const user = userEvent.setup();
    render(<AccountForm />);

    // 等待预填完成后再编辑
    const nameInput = await screen.findByLabelText<HTMLInputElement>("姓名");
    await user.clear(nameInput);
    await user.type(nameInput, "李四");

    // 提交表单
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 成功提示出现（需求 2.6）
    await waitFor(() => {
      expect(screen.getByText("账户资料已成功保存")).toBeInTheDocument();
    });

    // 在成功提示区域内断言展示了服务端返回的最新资料（需求 2.6）。
    // 限定在 role="status" 的成功区块内查询，避免与回填到表单输入的同名值冲突。
    const successRegion = screen.getByRole("status");
    expect(within(successRegion).getByText("李四")).toBeInTheDocument();
    expect(within(successRegion).getByText("lisi@example.com")).toBeInTheDocument();
    expect(within(successRegion).getByText("上海市浦东新区")).toBeInTheDocument();

    // 校验通过路径下确以 PUT 提交至账户端点
    expect(mockSendJson).toHaveBeenCalledWith(
      "/api/account",
      "PUT",
      expect.objectContaining({ name: "李四" })
    );
  });

  it("校验失败时在对应字段旁显示错误并保留用户输入（需求 2.7）", async () => {
    const initial: AccountProfile = {
      name: "张三",
      email: "zhangsan@example.com",
      phone: "13800138000",
      address: "北京市海淀区",
    };
    mockGetJson.mockResolvedValue(ok(initial));
    // 模拟服务端返回 VALIDATION 错误，并通过 error.field 指明出错字段为 email
    mockSendJson.mockResolvedValue({
      ok: false,
      error: {
        type: "VALIDATION",
        message: "邮箱格式不正确",
        field: "email",
      },
    });

    const user = userEvent.setup();
    render(<AccountForm />);

    // 等待预填完成，输入一个非法邮箱
    const emailInput = await screen.findByLabelText<HTMLInputElement>("邮箱");
    await user.clear(emailInput);
    await user.type(emailInput, "bad-email");

    // 提交表单
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 字段错误信息出现（需求 2.7）
    const fieldError = await screen.findByRole("alert");
    expect(fieldError).toHaveTextContent("邮箱格式不正确");

    // 错误展示在「正确的字段」旁：邮箱输入被标记为 aria-invalid，
    // 且通过 aria-describedby 关联到该错误元素
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput.getAttribute("aria-describedby")).toBe(fieldError.id);

    // 关键断言：用户输入被保留，不因校验失败而清空（需求 2.7）
    expect(emailInput).toHaveValue("bad-email");

    // 其他字段同样保留预填值
    expect(screen.getByLabelText<HTMLInputElement>("姓名")).toHaveValue("张三");

    // 校验失败时不应出现成功提示
    expect(screen.queryByText("账户资料已成功保存")).not.toBeInTheDocument();
  });
});
