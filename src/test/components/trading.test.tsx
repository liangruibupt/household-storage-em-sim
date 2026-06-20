// 智能电力交易功能区组件测试（任务 18.2）
//
// 覆盖需求：
//   - 4.1：策略列表展示策略及其启用状态（已启用/已停用文本，不依赖颜色）。
//   - 4.2：无策略时显示「暂无策略」空状态（正常状态而非错误）。
//   - 4.3：创建策略交互——填写并提交后经 POST /api/trading/strategies 提交正确入参。
//   - 4.6：启停切换交互——经 PUT /api/trading/strategies/{id} 提交 { enabled } 取反补丁。
//   - 4.7：删除交互——经 DELETE /api/trading/strategies/{id} 删除策略。
//   - 4.11：MarketPanel 展示当前电价；ActionHistory 按时间倒序（最新在前）且最多 50 条。
//
// 通过 vi.mock 模拟 HTTP 客户端封装（@/lib/http/client）的 getJson / sendJson，
// 返回受控的 Result；交互使用 @testing-library/user-event，异步断言使用 waitFor / findBy。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MarketState,
  Result,
  StrategyActionRecord,
  TradingStrategy,
} from "@/lib/data-access/types";

// —— 模拟 HTTP 客户端：仅替换组件实际使用的 getJson / sendJson ——
vi.mock("@/lib/http/client", () => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

import { getJson, sendJson } from "@/lib/http/client";
import StrategyList from "@/components/trading/strategy-list";
import StrategyForm from "@/components/trading/strategy-form";
import StrategyToggle from "@/components/trading/strategy-toggle";
import DeleteStrategy from "@/components/trading/delete-strategy";
import MarketPanel from "@/components/trading/market-panel";
import ActionHistory from "@/components/trading/action-history";
import TradingPage from "@/app/trading/page";

// 取得带类型的 mock 句柄，便于在每个用例中定制返回值
const mockGetJson = vi.mocked(getJson);
const mockSendJson = vi.mocked(sendJson);

/** 构造成功结果信封 */
function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 构造一条交易策略测试夹具 */
function makeStrategy(
  overrides: Partial<TradingStrategy> = {}
): TradingStrategy {
  return {
    id: "s1",
    name: "夜间低价充电",
    action: "charge",
    condition: { comparator: "less_than", priceThreshold: 0.3 },
    enabled: true,
    triggered: false,
    ...overrides,
  };
}

/** 构造一条触发记录测试夹具 */
function makeRecord(
  overrides: Partial<StrategyActionRecord> = {}
): StrategyActionRecord {
  return {
    strategyId: "s1",
    strategyName: "夜间低价充电",
    action: "charge",
    price: 0.25,
    triggeredAt: "2024-05-20T08:30:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  // 每个用例前清空 mock 调用记录与实现，避免相互污染
  mockGetJson.mockReset();
  mockSendJson.mockReset();
});

// ============================================================
// StrategyList：展示策略及启用状态 / 空状态（需求 4.1、4.2）
// ============================================================
describe("StrategyList 策略列表（需求 4.1、4.2）", () => {
  it("展示策略名称及启用状态（已启用/已停用文本）", () => {
    const strategies = [
      makeStrategy({ id: "s1", name: "白天高价卖电", enabled: true }),
      makeStrategy({ id: "s2", name: "夜间低价充电", enabled: false }),
    ];

    render(<StrategyList strategies={strategies} />);

    // 两条策略名称均渲染
    expect(screen.getByText("白天高价卖电")).toBeInTheDocument();
    expect(screen.getByText("夜间低价充电")).toBeInTheDocument();

    // 启用状态以文本标识（不依赖颜色）：分别为「已启用」与「已停用」
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });

  it("无策略时显示「暂无策略」空状态而非错误", () => {
    render(<StrategyList strategies={[]} />);

    expect(screen.getByText("暂无策略")).toBeInTheDocument();
    // 空状态以 role=status 呈现（正常状态）
    expect(screen.getByRole("status")).toHaveTextContent("暂无策略");
  });
});

// ============================================================
// StrategyForm：创建策略交互（需求 4.3）
// ============================================================
describe("StrategyForm 创建策略（需求 4.3）", () => {
  it("填写并提交后经 POST /api/trading/strategies 提交正确入参并提示成功", async () => {
    const user = userEvent.setup();
    const created = makeStrategy({ id: "new1", name: "夜间充电" });
    mockSendJson.mockResolvedValue(ok(created));
    const onCreated = vi.fn();

    render(<StrategyForm onCreated={onCreated} />);

    // 填写名称与电价阈值（动作/比较关系使用默认 charge / greater_than）
    await user.type(screen.getByLabelText("策略名称"), "夜间充电");
    await user.type(screen.getByLabelText("电价阈值"), "0.5");

    // 提交表单
    await user.click(screen.getByRole("button", { name: "创建策略" }));

    // 经由 HTTP 客户端封装以 POST 提交至策略端点，入参结构正确
    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/trading/strategies",
        "POST",
        expect.objectContaining({
          name: "夜间充电",
          action: "charge",
          condition: { comparator: "greater_than", priceThreshold: 0.5 },
          enabled: true,
        })
      );
    });

    // 成功提示出现，且通知父级刷新
    expect(await screen.findByText("策略创建成功")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("校验失败时在对应字段旁展示错误并保留用户输入", async () => {
    const user = userEvent.setup();
    // 模拟服务端返回 VALIDATION 错误，field 指明 priceThreshold
    mockSendJson.mockResolvedValue({
      ok: false,
      error: {
        type: "VALIDATION",
        message: "电价阈值超出范围",
        field: "priceThreshold",
      },
    });

    render(<StrategyForm />);

    await user.type(screen.getByLabelText("策略名称"), "异常策略");
    await user.type(screen.getByLabelText("电价阈值"), "0.5");
    await user.click(screen.getByRole("button", { name: "创建策略" }));

    // 字段错误出现
    const fieldError = await screen.findByRole("alert");
    expect(fieldError).toHaveTextContent("电价阈值超出范围");

    // 用户输入保留，不因校验失败清空
    expect(screen.getByLabelText("策略名称")).toHaveValue("异常策略");
    // 校验失败不显示成功提示
    expect(screen.queryByText("策略创建成功")).not.toBeInTheDocument();
  });
});

// ============================================================
// StrategyToggle：启停切换交互（需求 4.6）
// ============================================================
describe("StrategyToggle 启停切换（需求 4.6）", () => {
  it("启用中的策略点击「停用」后 PUT 提交 { enabled: false }", async () => {
    const user = userEvent.setup();
    mockSendJson.mockResolvedValue(ok(makeStrategy({ enabled: false })));
    const onToggled = vi.fn();
    const strategy = makeStrategy({ id: "s1", enabled: true });

    render(<StrategyToggle strategy={strategy} onToggled={onToggled} />);

    // 启用中的策略，切换按钮文本为「停用」
    await user.click(screen.getByRole("button", { name: "停用策略" }));

    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/trading/strategies/s1",
        "PUT",
        { enabled: false }
      );
    });
    expect(onToggled).toHaveBeenCalledTimes(1);
  });

  it("停用中的策略点击「启用」后 PUT 提交 { enabled: true }", async () => {
    const user = userEvent.setup();
    mockSendJson.mockResolvedValue(ok(makeStrategy({ enabled: true })));
    const strategy = makeStrategy({ id: "s2", enabled: false });

    render(<StrategyToggle strategy={strategy} />);

    await user.click(screen.getByRole("button", { name: "启用策略" }));

    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/trading/strategies/s2",
        "PUT",
        { enabled: true }
      );
    });
  });

  it("切换失败时回调 onError 携带中文错误提示", async () => {
    const user = userEvent.setup();
    mockSendJson.mockResolvedValue({
      ok: false,
      error: { type: "PROVIDER_ERROR", message: "服务暂时不可用，请稍后重试" },
    });
    const onError = vi.fn();

    render(
      <StrategyToggle strategy={makeStrategy({ enabled: true })} onError={onError} />
    );

    await user.click(screen.getByRole("button", { name: "停用策略" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("服务暂时不可用，请稍后重试");
    });
  });
});

// ============================================================
// DeleteStrategy：删除交互（需求 4.7）
// ============================================================
describe("DeleteStrategy 删除策略（需求 4.7）", () => {
  it("点击删除后经 DELETE /api/trading/strategies/{id} 删除并回调 onDeleted", async () => {
    const user = userEvent.setup();
    mockSendJson.mockResolvedValue(ok({ id: "s1" }));
    const onDeleted = vi.fn();
    const strategy = makeStrategy({ id: "s1", name: "夜间低价充电" });

    render(<DeleteStrategy strategy={strategy} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "删除策略 夜间低价充电" }));

    await waitFor(() => {
      expect(mockSendJson).toHaveBeenCalledWith(
        "/api/trading/strategies/s1",
        "DELETE"
      );
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// MarketPanel：展示当前电价（需求 4.11）
// ============================================================
describe("MarketPanel 当前电价（需求 4.11）", () => {
  it("展示当前电价并保留 2 位小数", () => {
    render(<MarketPanel currentPrice={0.5} />);

    expect(screen.getByText("当前电价")).toBeInTheDocument();
    // 电价保留 2 位小数展示，单位元/kWh
    expect(screen.getByText("0.50 元/kWh")).toBeInTheDocument();
  });
});

// ============================================================
// ActionHistory：倒序展示且最多 50 条（需求 4.11）
// ============================================================
describe("ActionHistory 触发历史（需求 4.11）", () => {
  it("按 triggeredAt 时间倒序展示（最新在前）", () => {
    // 故意以乱序提供，组件应自行按时间倒序
    const history = [
      makeRecord({
        strategyName: "较早",
        triggeredAt: "2024-05-20T08:00:00Z",
      }),
      makeRecord({
        strategyName: "最新",
        triggeredAt: "2024-05-20T10:00:00Z",
      }),
      makeRecord({
        strategyName: "居中",
        triggeredAt: "2024-05-20T09:00:00Z",
      }),
    ];

    const { container } = render(<ActionHistory history={history} />);

    const items = container.querySelectorAll(".action-history__item");
    expect(items).toHaveLength(3);
    // 第一项为最新，最后一项为最早
    expect(items[0]).toHaveTextContent("最新");
    expect(items[1]).toHaveTextContent("居中");
    expect(items[2]).toHaveTextContent("较早");
  });

  it("触发记录超过 50 条时截断为最多 50 条", () => {
    // 构造 60 条记录，时间各不相同
    const history: StrategyActionRecord[] = Array.from(
      { length: 60 },
      (_, i) =>
        makeRecord({
          strategyId: `s${i}`,
          strategyName: `策略${i}`,
          // 递增时间，便于验证倒序后保留的是最新的 50 条
          triggeredAt: new Date(2024, 4, 20, 0, i, 0).toISOString(),
        })
    );

    const { container } = render(<ActionHistory history={history} />);

    const items = container.querySelectorAll(".action-history__item");
    expect(items).toHaveLength(50);
  });

  it("无历史记录时显示空状态而非错误", () => {
    render(<ActionHistory history={[]} />);

    expect(screen.getByText("暂无触发记录")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("暂无触发记录");
  });
});

// ============================================================
// TradingPage：页面级集成（需求 4.1、4.11）
// ============================================================
describe("TradingPage 电力交易页面（需求 4.1、4.11）", () => {
  it("加载后展示策略列表、当前电价与触发历史", async () => {
    const strategies = [makeStrategy({ id: "s1", name: "夜间低价充电" })];
    const market: MarketState = {
      currentPrice: 0.42,
      // 历史记录使用不同名称，避免与策略列表中的同名文本产生歧义
      history: [makeRecord({ strategyName: "白天高价卖电" })],
    };

    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/trading/strategies") return ok(strategies);
      if (url === "/api/trading/market") return ok(market);
      return ok(null);
    });

    render(<TradingPage />);

    // 策略列表加载完成（需求 4.1）
    expect(await screen.findByText("夜间低价充电")).toBeInTheDocument();

    // 当前电价展示（需求 4.11）
    expect(await screen.findByText("0.42 元/kWh")).toBeInTheDocument();

    // 两个数据端点均被请求
    expect(mockGetJson).toHaveBeenCalledWith("/api/trading/strategies");
    expect(mockGetJson).toHaveBeenCalledWith("/api/trading/market");
  });

  it("无策略时页面展示「暂无策略」空状态", async () => {
    mockGetJson.mockImplementation(async (url: string) => {
      if (url === "/api/trading/strategies") return ok([]);
      if (url === "/api/trading/market")
        return ok({ currentPrice: 0.42, history: [] } as MarketState);
      return ok(null);
    });

    render(<TradingPage />);

    expect(await screen.findByText("暂无策略")).toBeInTheDocument();
  });
});
