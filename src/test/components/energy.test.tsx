// 充放电数据可视化功能区组件测试（任务 17.2）
//
// 覆盖需求：
//   - 3.1：当日总充/放电量以 kWh 展示且恒保留 2 位小数（TodaySummaryCards）。
//   - 3.4：设备数 ≥ 2 时显示设备范围切换，切换后携带 deviceId 重新请求（DeviceScopeToggle + 页面）。
//   - 3.6：失败/超时时显示错误 + 重试，且不清空已有内容（EnergyPage）。
//   - 3.2/3.5：7 天数据按日期升序展示，缺失日零填充显示为 0（WeeklyChart，经页面渲染）。
//
// 测试策略：
//   - mock 前端 HTTP 客户端（@/lib/http/client）的 getJson，按 URL 返回受控的 summary/weekly/devices。
//   - mock recharts 为轻量桩组件：将 BarChart 的 data 渲染为可断言的 DOM 列表，
//     从而在 jsdom 中稳健断言 7 天数据的顺序与零填充（无需真实图表布局/宽度）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  ChargeDischargeRecord,
  DailySummary,
  Device,
  Result,
} from "@/lib/data-access/types";

// ============================================================
// 模块 mock
// ============================================================

// mock 前端 HTTP 客户端：页面仅依赖 getJson
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
}));

// mock recharts：将 BarChart 的 data 渲染为可断言的列表项，其余子组件渲染为 null。
// 工厂内通过动态 import 获取 React，避免引用测试文件顶层变量（vi.mock 会被提升）。
vi.mock("recharts", async () => {
  const React = await import("react");
  // 透传容器：仅渲染子节点，不需要真实布局宽高
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    ResponsiveContainer: Passthrough,
    BarChart: ({
      data,
      children,
    }: {
      data?: Array<{ label: string; charge: number; discharge: number }>;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "bar-chart" },
        React.createElement(
          "ul",
          null,
          (data ?? []).map((d, i) =>
            React.createElement(
              "li",
              { key: i, "data-testid": "weekly-point" },
              `${d.label}|${d.charge}|${d.discharge}`
            )
          )
        ),
        children
      ),
    Bar: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

// 被测组件需在 mock 声明之后导入
import { getJson } from "@/lib/http/client";
import TodaySummaryCards from "@/components/energy/today-summary-cards";
import EnergyPage from "@/app/energy/page";

const mockGetJson = vi.mocked(getJson);

// ============================================================
// 测试夹具与辅助
// ============================================================

/** 构造成功 Result */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 构造失败 Result */
function fail<T>(message: string): Result<T> {
  return { ok: false, error: { type: "PROVIDER_ERROR", message } };
}

/** 两台设备的固定夹具（用于触发范围切换器显示） */
const twoDevices: Device[] = [
  {
    id: "dev-1",
    name: "客厅储能",
    connectionStatus: "online",
    lastReportedAt: "2024-03-07T10:00:00.000Z",
  },
  {
    id: "dev-2",
    name: "车库储能",
    connectionStatus: "offline",
    lastReportedAt: "2024-03-07T09:00:00.000Z",
  },
];

/** 单台设备的固定夹具（用于验证不显示范围切换器） */
const oneDevice: Device[] = [twoDevices[0]];

/**
 * 配置 getJson 的按 URL 路由实现。
 *
 * 参数:
 *   routes: 各资源的返回值提供器（接收完整 url，便于按查询参数定制）
 */
function setupRoutes(routes: {
  devices: () => Result<Device[]>;
  summary: (url: string) => Result<DailySummary>;
  weekly: (url: string) => Result<ChargeDischargeRecord[]>;
}): void {
  mockGetJson.mockImplementation((url: string) => {
    if (url.startsWith("/api/devices")) {
      return Promise.resolve(routes.devices() as Result<unknown>);
    }
    if (url.startsWith("/api/energy/summary")) {
      return Promise.resolve(routes.summary(url) as Result<unknown>);
    }
    if (url.startsWith("/api/energy/weekly")) {
      return Promise.resolve(routes.weekly(url) as Result<unknown>);
    }
    return Promise.resolve(fail("未知路由") as Result<unknown>);
  });
}

beforeEach(() => {
  mockGetJson.mockReset();
});

// ============================================================
// TodaySummaryCards：当日总量 2 位小数（需求 3.1）
// ============================================================

describe("TodaySummaryCards 当日总量展示（需求 3.1）", () => {
  /** 读取某张卡片 value 节点中的数值文本（去掉单位 kWh） */
  function readValue(container: HTMLElement, kind: "charge" | "discharge"): string {
    const node = container.querySelector(
      `.summary-card--${kind} .summary-card__value`
    );
    // textContent 形如 "12.50 kWh"，去掉单位仅保留数值部分
    return (node?.textContent ?? "").replace("kWh", "").trim();
  }

  it("将整数与小数总量均格式化为恰好 2 位小数", () => {
    const summary: DailySummary = {
      date: "2024-03-07",
      totalChargeKwh: 12.5,
      totalDischargeKwh: 7,
    };
    const { container } = render(<TodaySummaryCards summary={summary} />);

    const charge = readValue(container, "charge");
    const discharge = readValue(container, "discharge");

    expect(charge).toBe("12.50");
    expect(discharge).toBe("7.00");
    // 断言「恰好 2 位小数」的格式
    expect(charge).toMatch(/^\d+\.\d{2}$/);
    expect(discharge).toMatch(/^\d+\.\d{2}$/);
  });

  it("零值展示为 0.00 而非占位符", () => {
    const summary: DailySummary = {
      date: "2024-03-07",
      totalChargeKwh: 0,
      totalDischargeKwh: 0,
    };
    const { container } = render(<TodaySummaryCards summary={summary} />);
    expect(readValue(container, "charge")).toBe("0.00");
    expect(readValue(container, "discharge")).toBe("0.00");
  });

  it("尚无成功数据（null）时以占位符「—」展示", () => {
    const { container } = render(<TodaySummaryCards summary={null} />);
    expect(readValue(container, "charge")).toBe("—");
    expect(readValue(container, "discharge")).toBe("—");
  });
});

// ============================================================
// EnergyPage：7 天升序 + 零填充（需求 3.2、3.5）
// ============================================================

describe("EnergyPage 7 天充放电图（需求 3.2、3.5）", () => {
  it("按日期升序渲染 7 天数据，且包含零填充日（值为 0）", async () => {
    // 故意乱序提供，且包含 charge/discharge 均为 0 的零填充日（03-03）
    const weekly: ChargeDischargeRecord[] = [
      { date: "2024-03-05", chargeKwh: 5, dischargeKwh: 2 },
      { date: "2024-03-01", chargeKwh: 1, dischargeKwh: 1 },
      { date: "2024-03-03", chargeKwh: 0, dischargeKwh: 0 },
      { date: "2024-03-02", chargeKwh: 2, dischargeKwh: 1 },
      { date: "2024-03-07", chargeKwh: 7, dischargeKwh: 3 },
      { date: "2024-03-04", chargeKwh: 4, dischargeKwh: 2 },
      { date: "2024-03-06", chargeKwh: 6, dischargeKwh: 3 },
    ];
    setupRoutes({
      devices: () => ok(oneDevice),
      summary: () =>
        ok({ date: "2024-03-07", totalChargeKwh: 25, totalDischargeKwh: 12 }),
      weekly: () => ok(weekly),
    });

    render(<EnergyPage />);

    // 等待图表数据点渲染
    await waitFor(() => {
      expect(screen.getAllByTestId("weekly-point")).toHaveLength(7);
    });

    const labels = screen
      .getAllByTestId("weekly-point")
      .map((li) => (li.textContent ?? "").split("|")[0]);

    // 断言横轴标签按日期升序排列
    expect(labels).toEqual([
      "03-01",
      "03-02",
      "03-03",
      "03-04",
      "03-05",
      "03-06",
      "03-07",
    ]);

    // 断言零填充日（03-03）的充/放电量均为 0
    const zeroPoint = screen
      .getAllByTestId("weekly-point")
      .find((li) => (li.textContent ?? "").startsWith("03-03"));
    expect(zeroPoint?.textContent).toBe("03-03|0|0");
  });
});

// ============================================================
// DeviceScopeToggle 显示条件与切换重新请求（需求 3.4）
// ============================================================

describe("EnergyPage 设备范围切换（需求 3.4）", () => {
  it("设备数 < 2 时不显示范围切换器", async () => {
    setupRoutes({
      devices: () => ok(oneDevice),
      summary: () =>
        ok({ date: "2024-03-07", totalChargeKwh: 1, totalDischargeKwh: 1 }),
      weekly: () => ok([{ date: "2024-03-07", chargeKwh: 1, dischargeKwh: 1 }]),
    });

    render(<EnergyPage />);

    // 等待首屏加载完成（图表出现）
    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });

    // 单设备时不应渲染范围切换下拉
    expect(screen.queryByLabelText("数据范围")).not.toBeInTheDocument();
  });

  it("设备数 ≥ 2 时显示范围切换器，切换后携带 deviceId 重新请求", async () => {
    setupRoutes({
      devices: () => ok(twoDevices),
      summary: () =>
        ok({ date: "2024-03-07", totalChargeKwh: 10, totalDischargeKwh: 5 }),
      weekly: () => ok([{ date: "2024-03-07", chargeKwh: 1, dischargeKwh: 1 }]),
    });

    render(<EnergyPage />);

    // 等待范围切换器出现（设备数 ≥ 2）
    const select = await screen.findByLabelText("数据范围");
    expect(select).toBeInTheDocument();

    // 记录切换前对 summary/weekly 的请求次数
    const energyCallsBefore = mockGetJson.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/energy/")
    ).length;

    // 切换到单设备 dev-2
    fireEvent.change(select, { target: { value: "dev-2" } });

    // 断言切换后携带 deviceId=dev-2 重新请求 summary 与 weekly
    await waitFor(() => {
      const summaryRefetch = mockGetJson.mock.calls.some(
        ([url]) => String(url) === "/api/energy/summary?deviceId=dev-2"
      );
      const weeklyRefetch = mockGetJson.mock.calls.some(
        ([url]) => String(url) === "/api/energy/weekly?deviceId=dev-2"
      );
      expect(summaryRefetch).toBe(true);
      expect(weeklyRefetch).toBe(true);
    });

    const energyCallsAfter = mockGetJson.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/energy/")
    ).length;
    // 触发了额外的重新请求
    expect(energyCallsAfter).toBeGreaterThan(energyCallsBefore);
  });
});

// ============================================================
// 失败保留既有内容 + 重试（需求 3.6）
// ============================================================

describe("EnergyPage 失败保留内容与重试（需求 3.6）", () => {
  it("刷新失败时显示错误并保留已有内容，重试成功后恢复", async () => {
    // 初次：全部成功，当日总充电量 12.50
    setupRoutes({
      devices: () => ok(twoDevices),
      summary: () =>
        ok({ date: "2024-03-07", totalChargeKwh: 12.5, totalDischargeKwh: 3 }),
      weekly: () => ok([{ date: "2024-03-07", chargeKwh: 1, dischargeKwh: 1 }]),
    });

    const { container } = render(<EnergyPage />);

    // 等待初始内容渲染（12.50）
    await waitFor(() => {
      const charge = container.querySelector(
        ".summary-card--charge .summary-card__value"
      );
      expect(charge?.textContent ?? "").toContain("12.50");
    });

    // 切换数据源：使 summary 请求失败（weekly 仍成功）
    setupRoutes({
      devices: () => ok(twoDevices),
      summary: () => fail("服务暂时不可用"),
      weekly: () => ok([{ date: "2024-03-07", chargeKwh: 1, dischargeKwh: 1 }]),
    });

    // 通过范围切换触发一次重新请求 → summary 失败
    const select = await screen.findByLabelText("数据范围");
    fireEvent.change(select, { target: { value: "dev-2" } });

    // 断言显示错误提示
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("服务暂时不可用");
    });

    // 失败后仍保留既有内容（旧的 12.50 仍在）
    const chargeAfterError = container.querySelector(
      ".summary-card--charge .summary-card__value"
    );
    expect(chargeAfterError?.textContent ?? "").toContain("12.50");

    // 切换数据源：重试成功，当日总充电量更新为 99.00
    setupRoutes({
      devices: () => ok(twoDevices),
      summary: () =>
        ok({ date: "2024-03-07", totalChargeKwh: 99, totalDischargeKwh: 4 }),
      weekly: () => ok([{ date: "2024-03-07", chargeKwh: 2, dischargeKwh: 2 }]),
    });

    // 点击错误态中的「重试」按钮
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    // 重试成功后错误消失、内容更新为 99.00
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      const charge = container.querySelector(
        ".summary-card--charge .summary-card__value"
      );
      expect(charge?.textContent ?? "").toContain("99.00");
    });
  });
});
