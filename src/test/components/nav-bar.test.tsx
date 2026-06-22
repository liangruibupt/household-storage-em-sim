import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// NavBar 导航单元测试（任务 14.2，_Requirements: 6.1, 6.2, 6.3_）
//
// 测试目标：
//   - 需求 6.1：导航含且仅含四个入口（设备监控、账户信息、充放电数据、电力交易），
//     且每个入口都是可点击的链接（<a>，带 href）。
//   - 需求 6.2：导航常驻可见（<nav> 始终存在于文档中）。
//   - 需求 6.3：选中态依据当前路径派生（aria-current="page"），切换路径后选中项随之变化。
//
// next/navigation 的 usePathname 必须被 mock，使该客户端组件在 jsdom 下确定性渲染。
// 这里用一个可控的 mock 函数，便于在不同测试中切换不同路径以验证选中态。

// 受控的当前路径值：各测试通过 setPathname 改变它，mock 的 usePathname 读取它。
let mockPathname: string | null = "/devices";

function setPathname(value: string | null): void {
  mockPathname = value;
}

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// NavBar 渲染常驻账户切换器 AccountSwitcher（消费 AccountContext）。
// 为使该客户端组件在无 Provider 的单元测试中可确定性渲染，mock useAccount，
// 返回「无账户」的稳定状态（切换器仅渲染占位，不影响导航相关断言）。
vi.mock("@/components/account/account-context", () => ({
  useAccount: () => ({
    accounts: [],
    currentAccountId: null,
    loading: false,
    error: null,
    setCurrentAccount: vi.fn(),
    refreshAccounts: vi.fn(),
  }),
}));

// 在 mock 声明之后导入被测组件，确保组件使用的是被 mock 的 usePathname。
import NavBar, { NAV_ITEMS } from "../../components/nav-bar";

// 四个固定入口的显示文本，顺序与需求一致。
const EXPECTED_LABELS = ["设备监控", "账户信息", "充放电数据", "电力交易"] as const;
const EXPECTED_HREFS = ["/devices", "/account", "/energy", "/trading"] as const;

describe("NavBar 常驻导航", () => {
  beforeEach(() => {
    // 每个测试前恢复默认路径，避免相互影响。
    setPathname("/devices");
  });

  it("常量 NAV_ITEMS 恰好定义四个入口且文本与顺序符合需求 6.1", () => {
    expect(NAV_ITEMS).toHaveLength(4);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([...EXPECTED_LABELS]);
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([...EXPECTED_HREFS]);
  });

  it("渲染恰好四个导航入口，且每个都是可点击的链接（需求 6.1）", () => {
    render(<NavBar />);

    const nav = screen.getByRole("navigation", { name: "主导航" });
    const links = within(nav).getAllByRole("link");

    // 含且仅含四个入口
    expect(links).toHaveLength(4);

    // 每个入口文本正确，且为带 href 的可点击链接（<a>）
    EXPECTED_LABELS.forEach((label, index) => {
      const link = screen.getByRole("link", { name: label });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", EXPECTED_HREFS[index]);
    });
  });

  it("导航常驻可见：<nav> 始终存在于文档中（需求 6.2）", () => {
    render(<NavBar />);
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });

  it("当前路径为 /devices 时，仅“设备监控”标记为选中态（需求 6.3）", () => {
    setPathname("/devices");
    render(<NavBar />);

    const active = screen.getByRole("link", { name: "设备监控" });
    expect(active).toHaveAttribute("aria-current", "page");

    // 其余入口不应处于选中态
    ["账户信息", "充放电数据", "电力交易"].forEach((label) => {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute(
        "aria-current",
      );
    });
  });

  it("切换到不同路径 /trading 时，选中态随之切换到“电力交易”（需求 6.3）", () => {
    setPathname("/trading");
    render(<NavBar />);

    const active = screen.getByRole("link", { name: "电力交易" });
    expect(active).toHaveAttribute("aria-current", "page");

    // 之前默认选中的“设备监控”不再处于选中态
    expect(screen.getByRole("link", { name: "设备监控" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("子路由路径（如 /devices/123）仍将父入口标记为选中态（需求 6.3）", () => {
    setPathname("/devices/123");
    render(<NavBar />);

    expect(screen.getByRole("link", { name: "设备监控" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("路径为 null 时不应有任何入口处于选中态（边界情况）", () => {
    setPathname(null);
    render(<NavBar />);

    EXPECTED_LABELS.forEach((label) => {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute(
        "aria-current",
      );
    });
  });
});
