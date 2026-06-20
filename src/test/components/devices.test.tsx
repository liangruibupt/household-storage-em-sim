// 设备监控功能区组件测试（任务 15.2）
//
// 覆盖需求：
//   - 1.4：状态徽章「双重标识」——在线/离线呈现不同文本标签（在线/离线）与不同样式，
//          即使不依赖颜色也能区分（断言文本 + aria-label，而非仅颜色类）。
//   - 1.5：刷新交互——点击刷新重新拉取设备列表并更新展示。
//   - 1.6：空状态——设备列表为空时显示「暂无设备」；非空时渲染条目且选中回调触发。
//   - 1.7：失败保留 + 重试——刷新失败时保留上一次列表并提供重试，重试成功后更新。
//   - 1.8：设备详情字段——展示名称、唯一标识、连接状态与「精确到秒」的更新时间。
//
// 通过 vi.mock 模拟 HTTP 客户端封装（@/lib/http/client）的 getJson，
// 返回受控的 Result（成功 / 错误 / 重试后成功），并以 waitFor/findBy 处理异步状态。

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 模拟 HTTP 客户端：仅替换 getJson，使组件经由它获取受控数据
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "@/lib/http/client";
import StatusBadge from "@/components/devices/status-badge";
import DeviceList from "@/components/devices/device-list";
import DeviceDetail from "@/components/devices/device-detail";
import DevicesPage from "@/app/devices/page";
import type {
  ConnectionStatus,
  Device,
  DeviceDetail as DeviceDetailModel,
  Result,
} from "@/lib/data-access/types";

// 将受 mock 的 getJson 视为通用 Mock，便于按 url 配置返回值（绕开泛型签名约束）
const mockGetJson = getJson as unknown as Mock;

/** 构造一台设备的测试夹具 */
function makeDevice(
  id: string,
  name: string,
  status: ConnectionStatus
): Device {
  return {
    id,
    name,
    connectionStatus: status,
    lastReportedAt: "2024-05-20T08:30:00Z",
  };
}

/** 成功结果包装 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

beforeEach(() => {
  // 每个测试前清空 mock，避免实现/返回值串扰
  mockGetJson.mockReset();
});

// ============================================================
// StatusBadge：双重标识（需求 1.4）
// ============================================================
describe("StatusBadge 状态徽章（需求 1.4）", () => {
  it("在线状态渲染「在线」文本与 aria-label，而非仅靠颜色区分", () => {
    const { container } = render(<StatusBadge status="online" />);

    // 文本标签可见
    expect(screen.getByText("在线")).toBeInTheDocument();

    const badge = container.querySelector(".status-badge");
    // 非颜色可区分信息：可读名称（aria-label）
    expect(badge).toHaveAttribute("aria-label", "在线");
    // 颜色修饰类同时存在（颜色是补充而非唯一区分手段）
    expect(badge).toHaveClass("status-badge--online");
  });

  it("离线状态渲染「离线」文本与 aria-label", () => {
    const { container } = render(<StatusBadge status="offline" />);

    expect(screen.getByText("离线")).toBeInTheDocument();

    const badge = container.querySelector(".status-badge");
    expect(badge).toHaveAttribute("aria-label", "离线");
    expect(badge).toHaveClass("status-badge--offline");
  });

  it("在线与离线的文本标签彼此不同，确保不依赖颜色即可区分", () => {
    const { container: onlineC } = render(<StatusBadge status="online" />);
    const onlineLabel = onlineC
      .querySelector(".status-badge")
      ?.getAttribute("aria-label");

    const { container: offlineC } = render(<StatusBadge status="offline" />);
    const offlineLabel = offlineC
      .querySelector(".status-badge")
      ?.getAttribute("aria-label");

    expect(onlineLabel).toBe("在线");
    expect(offlineLabel).toBe("离线");
    expect(onlineLabel).not.toBe(offlineLabel);
  });
});

// ============================================================
// DeviceList：空状态与选中（需求 1.6）
// ============================================================
describe("DeviceList 设备列表（需求 1.6）", () => {
  it("空列表显示「暂无设备」空状态", () => {
    render(<DeviceList devices={[]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("暂无设备")).toBeInTheDocument();
    // 空状态以 role=status 呈现（正常状态而非错误）
    expect(screen.getByRole("status")).toHaveTextContent("暂无设备");
  });

  it("非空列表渲染各设备条目，并在点击时触发选中回调", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const devices = [
      makeDevice("d1", "设备一", "online"),
      makeDevice("d2", "设备二", "offline"),
    ];

    render(
      <DeviceList devices={devices} selectedId={null} onSelect={onSelect} />
    );

    // 两台设备名称均渲染
    expect(screen.getByText("设备一")).toBeInTheDocument();
    expect(screen.getByText("设备二")).toBeInTheDocument();

    // 点击第一台设备的条目，回调收到其 id
    await user.click(screen.getByRole("button", { name: /设备一/ }));
    expect(onSelect).toHaveBeenCalledWith("d1");
  });
});

// ============================================================
// DeviceDetail：字段渲染（需求 1.8）
// ============================================================
describe("DeviceDetail 设备详情（需求 1.8）", () => {
  it("展示名称、唯一标识、连接状态与精确到秒的更新时间", async () => {
    const detail: DeviceDetailModel = {
      id: "d1",
      name: "客厅储能",
      connectionStatus: "online",
      lastReportedAt: "2024-05-20T08:30:00Z",
      // 秒位为 07，时区偏移不会改变秒数，可稳定断言「精确到秒」
      lastStatusUpdatedAt: "2024-05-20T08:30:07Z",
    };
    mockGetJson.mockResolvedValue(ok(detail));

    const { container } = render(<DeviceDetail deviceId="d1" />);

    // 名称与唯一标识
    expect(await screen.findByText("客厅储能")).toBeInTheDocument();
    expect(screen.getByText("d1")).toBeInTheDocument();

    // 连接状态徽章（文本 + aria-label）
    expect(screen.getByText("在线")).toBeInTheDocument();

    // 精确到秒的时间格式：YYYY-MM-DD HH:mm:ss，且秒位为 07
    expect(container.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:07/);

    // 经由 HTTP 客户端封装访问对应详情端点
    expect(mockGetJson).toHaveBeenCalledWith("/api/devices/d1");
  });
});

// ============================================================
// DevicesPage：刷新交互、失败保留 + 重试（需求 1.5、1.7）
// ============================================================
describe("DevicesPage 设备监控页面（需求 1.5、1.7）", () => {
  it("点击刷新后重新拉取设备列表并更新展示", async () => {
    const user = userEvent.setup();
    const list1 = [makeDevice("d1", "设备一", "online")];
    const list2 = [
      makeDevice("d1", "设备一", "online"),
      makeDevice("d2", "设备二", "offline"),
    ];

    let deviceCalls = 0;
    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/devices") {
        deviceCalls += 1;
        // 首次返回 list1，刷新后返回 list2
        return deviceCalls === 1 ? ok(list1) : ok(list2);
      }
      return ok(null);
    });

    render(<DevicesPage />);

    // 首次加载完成：仅有「设备一」
    expect(await screen.findByText("设备一")).toBeInTheDocument();
    expect(screen.queryByText("设备二")).not.toBeInTheDocument();

    // 点击刷新，等待新增的「设备二」出现
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("设备二")).toBeInTheDocument();
  });

  it("刷新失败时保留上一次列表并显示重试，重试成功后更新列表", async () => {
    const user = userEvent.setup();
    const list1 = [makeDevice("d1", "设备一", "online")];
    const list2 = [
      makeDevice("d1", "设备一", "online"),
      makeDevice("d2", "设备二", "offline"),
    ];

    let deviceCalls = 0;
    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/devices") {
        deviceCalls += 1;
        if (deviceCalls === 1) return ok(list1); // 首次成功
        if (deviceCalls === 2) {
          // 第二次（刷新）失败
          return {
            ok: false as const,
            error: {
              type: "PROVIDER_ERROR" as const,
              message: "服务暂时不可用，请稍后重试",
            },
          };
        }
        return ok(list2); // 重试成功
      }
      return ok(null);
    });

    render(<DevicesPage />);

    // 首次加载完成
    expect(await screen.findByText("设备一")).toBeInTheDocument();

    // 刷新触发失败：显示错误提示，且保留上一次列表（设备一仍在）
    await user.click(screen.getByRole("button", { name: "刷新" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("服务暂时不可用，请稍后重试");
    expect(screen.getByText("设备一")).toBeInTheDocument();

    // 点击重试：成功后列表更新，错误消失
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("设备二")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("选中设备后展示其详情（页面级集成，需求 1.8）", async () => {
    const user = userEvent.setup();
    const list1 = [makeDevice("d1", "设备一", "online")];
    const detail: DeviceDetailModel = {
      id: "d1",
      name: "设备一",
      connectionStatus: "online",
      lastReportedAt: "2024-05-20T08:30:00Z",
      lastStatusUpdatedAt: "2024-05-20T08:30:07Z",
    };

    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/devices") return ok(list1);
      if (url === "/api/devices/d1") return ok(detail);
      return ok(null);
    });

    render(<DevicesPage />);

    // 列表加载后点击设备条目
    await user.click(await screen.findByRole("button", { name: /设备一/ }));

    // 详情区出现，展示唯一标识等字段
    const detailRegion = await screen.findByText("设备详情");
    expect(detailRegion).toBeInTheDocument();
    expect(await screen.findByText("唯一标识")).toBeInTheDocument();
    // 详情请求经由 HTTP 客户端封装发起
    expect(mockGetJson).toHaveBeenCalledWith("/api/devices/d1");
  });
});
