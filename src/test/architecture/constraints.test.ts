// 架构约束与单用户校验测试（任务 19.1，需求 5.1、5.3、5.4、6.4）
//
// 本测试以「静态源码扫描 + 类型/运行时契约校验」三部分覆盖架构层面的不变量，
// 不依赖运行时渲染，属于 SMOKE 类静态检查：
//
//  1) 分层导入约束（需求 5.1、5.4）
//     - src/components/ 与 src/app/（排除 src/app/api）中的源文件「绝不」import
//       具体数据来源 "@/lib/data-access/mock"（或其相对路径等价写法）；
//       UI 仅经 HTTP 客户端 / API 层访问数据。
//     - src/app/api 下的路由文件「仅」经抽象工厂/接口（factory / provider）访问数据访问层，
//       不直接 import 具体 MockProvider。
//     - 正向断言：API 层确实通过抽象工厂 getDataProvider() 获取数据提供者。
//
//  2) 可替换性（需求 5.3）
//     - 提供实现同一 IDataProvider 接口的「第二个」桩实现 StubProvider，
//       在类型层面可无缝赋值给 getDataProvider() 的返回类型（API 层与 UI 源码零改动即可编译通过），
//       并在运行时验证其 11 个方法全部存在且返回 Promise<Result<T>>。
//
//  3) 单用户约束（需求 6.4）
//     - createSeedData() 产出的种子数据恰好包含「单一」账户对象（而非账户集合），
//       全部数据归属该唯一 User。

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import type { IDataProvider } from "@/lib/data-access/provider";
import { getDataProvider } from "@/lib/data-access/factory";
import type {
  Result,
  Device,
  DeviceDetail,
  AccountProfile,
  AccountProfileInput,
  DailySummary,
  ChargeDischargeRecord,
  TradingStrategy,
  TradingStrategyInput,
  TradingStrategyPatch,
  MarketState,
} from "@/lib/data-access/types";
import { createSeedData } from "@/lib/data-access/mock/seed-data";

// ============================================================
// 通用：源码静态扫描工具
// ============================================================

// 测试运行于项目根目录（package.json 所在），故以 process.cwd() 为基准定位源码目录。
const PROJECT_ROOT = process.cwd();
const COMPONENTS_DIR = path.join(PROJECT_ROOT, "src", "components");
const APP_DIR = path.join(PROJECT_ROOT, "src", "app");
const API_DIR = path.join(PROJECT_ROOT, "src", "app", "api");

/** 待扫描的源码扩展名 */
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * 递归收集目录下的全部源码文件（.ts / .tsx）。
 *
 * @param dir 起始目录绝对路径
 * @param exclude 需要排除的目录绝对路径集合（其自身及子孙文件均跳过）
 * @returns 源码文件的绝对路径数组
 */
function collectSourceFiles(dir: string, exclude: string[] = []): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    // 跳过被排除的目录（如扫描 app 时排除 app/api）
    if (exclude.some((ex) => full === ex || full.startsWith(ex + path.sep))) {
      continue;
    }
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectSourceFiles(full, exclude));
    } else if (SOURCE_EXTENSIONS.has(path.extname(full))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 从源码文本中提取全部模块导入说明符（import/export from、副作用 import、动态 import、require）。
 *
 * @param source 源码文本
 * @returns 模块说明符字符串数组（如 "@/lib/data-access/mock/mock-provider"）
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns: RegExp[] = [
    // import ... from "..."
    /import\s+[^'"]*?\s+from\s*['"]([^'"]+)['"]/g,
    // export ... from "..."
    /export\s+[^'"]*?\s+from\s*['"]([^'"]+)['"]/g,
    // 副作用导入：import "..."
    /import\s*['"]([^'"]+)['"]/g,
    // 动态导入：import("...")
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // CommonJS：require("...")
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * 判定某导入说明符是否指向「具体 Mock 数据来源」实现。
 * 同时覆盖路径别名（@/lib/data-access/mock）与相对路径等价写法（../../lib/data-access/mock/...）。
 *
 * @param specifier 模块导入说明符
 * @returns 指向 data-access/mock 时返回 true
 */
function isMockDataSourceImport(specifier: string): boolean {
  return specifier.includes("data-access/mock");
}

// ============================================================
// 1) 分层导入约束（需求 5.1、5.4）
// ============================================================

describe("架构约束：分层导入（需求 5.1、5.4）", () => {
  it("components/ 与 app/（排除 app/api）不得 import 具体 Mock 数据来源", () => {
    const files = [
      ...collectSourceFiles(COMPONENTS_DIR),
      // 扫描 app 时排除 app/api（API 层允许经抽象工厂访问数据访问层）
      ...collectSourceFiles(APP_DIR, [API_DIR]),
    ];

    // 确保确有源码被扫描，避免「空集合恒通过」掩盖问题
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; specifier: string }[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (isMockDataSourceImport(specifier)) {
          violations.push({ file: path.relative(PROJECT_ROOT, file), specifier });
        }
      }
    }

    // 任何对 data-access/mock 的直接引用都视为违规
    expect(violations).toEqual([]);
  });

  it("app/api 路由文件不得直接 import 具体 MockProvider", () => {
    const apiFiles = collectSourceFiles(API_DIR);
    expect(apiFiles.length).toBeGreaterThan(0);

    const violations: { file: string; specifier: string }[] = [];
    for (const file of apiFiles) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (isMockDataSourceImport(specifier)) {
          violations.push({ file: path.relative(PROJECT_ROOT, file), specifier });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("app/api 经抽象工厂 getDataProvider() 访问数据访问层（正向断言）", () => {
    const apiFiles = collectSourceFiles(API_DIR);
    expect(apiFiles.length).toBeGreaterThan(0);

    // 至少存在一个 API 路由通过 @/lib/data-access/factory 获取数据提供者，
    // 说明数据访问统一经由抽象工厂/接口边界（而非具体实现）。
    const importsFactory = apiFiles.some((file) => {
      const source = readFileSync(file, "utf8");
      return extractImportSpecifiers(source).some((s) =>
        s.includes("data-access/factory")
      );
    });
    expect(importsFactory).toBe(true);

    // 反向保证：任何 API 文件若引用数据访问层，只允许 factory / provider / types，
    // 不允许出现 data-access/mock。
    for (const file of apiFiles) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (specifier.includes("data-access/")) {
          expect(isMockDataSourceImport(specifier)).toBe(false);
        }
      }
    }
  });
});

// ============================================================
// 2) 可替换性：第二个 IDataProvider 桩实现（需求 5.3）
// ============================================================

// 预置的契约良构样例数据，供桩实现返回，保证返回结构符合各方法契约。
const STUB_DEVICE: Device = {
  id: "stub-device-001",
  name: "桩设备 001",
  connectionStatus: "online",
  lastReportedAt: "2024-06-15T12:00:00.000Z",
};

const STUB_DEVICE_DETAIL: DeviceDetail = {
  ...STUB_DEVICE,
  lastStatusUpdatedAt: "2024-06-15T12:00:00Z",
};

const STUB_ACCOUNT: AccountProfile = {
  name: "桩用户",
  email: "stub@example.com",
  phone: "+86 138-0000-0000",
  address: "示例地址 1 号",
};

const STUB_SUMMARY: DailySummary = {
  date: "2024-06-15",
  totalChargeKwh: 0,
  totalDischargeKwh: 0,
};

const STUB_STRATEGY: TradingStrategy = {
  id: "stub-strategy-001",
  name: "桩策略",
  action: "charge",
  condition: { comparator: "greater_than", priceThreshold: 1 },
  enabled: true,
  triggered: false,
};

const STUB_MARKET: MarketState = {
  currentPrice: 1.23,
  history: [],
};

/**
 * StubProvider：实现同一 IDataProvider 接口的「第二个」具体实现。
 *
 * 其存在用于在「类型层面」证明 IDataProvider 接口足以支撑 API 层与 UI 的契约——
 * 任何符合该接口的实现均可经 getDataProvider() 注入，调用方源码零改动即可编译运行（需求 5.3）。
 * 各方法均返回 Promise<Result<T>>，与接口契约一致。
 */
class StubProvider implements IDataProvider {
  async listDevices(): Promise<Result<Device[]>> {
    return { ok: true, data: [STUB_DEVICE] };
  }

  async getDevice(deviceId: string): Promise<Result<DeviceDetail>> {
    return { ok: true, data: { ...STUB_DEVICE_DETAIL, id: deviceId } };
  }

  async getAccountProfile(): Promise<Result<AccountProfile>> {
    return { ok: true, data: STUB_ACCOUNT };
  }

  async updateAccountProfile(
    input: AccountProfileInput
  ): Promise<Result<AccountProfile>> {
    return { ok: true, data: input };
  }

  async getTodaySummary(_deviceId?: string): Promise<Result<DailySummary>> {
    return { ok: true, data: STUB_SUMMARY };
  }

  async getWeeklyRecords(
    _deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>> {
    return { ok: true, data: [] };
  }

  async listStrategies(): Promise<Result<TradingStrategy[]>> {
    return { ok: true, data: [STUB_STRATEGY] };
  }

  async createStrategy(
    input: TradingStrategyInput
  ): Promise<Result<TradingStrategy>> {
    return {
      ok: true,
      data: { ...STUB_STRATEGY, name: input.name, action: input.action },
    };
  }

  async updateStrategy(
    id: string,
    _patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>> {
    return { ok: true, data: { ...STUB_STRATEGY, id } };
  }

  async deleteStrategy(id: string): Promise<Result<{ id: string }>> {
    return { ok: true, data: { id } };
  }

  async getMarketState(): Promise<Result<MarketState>> {
    return { ok: true, data: STUB_MARKET };
  }
}

describe("可替换性：第二个 IDataProvider 桩实现（需求 5.3）", () => {
  it("StubProvider 可在类型层面赋值给 getDataProvider() 的返回类型", () => {
    // 类型层面：StubProvider 满足 IDataProvider，
    // 且可赋值给与 getDataProvider() 返回值同类型的变量（API 层注入点的类型）。
    const injected: ReturnType<typeof getDataProvider> = new StubProvider();
    const asInterface: IDataProvider = injected;
    // 运行时占位断言：确认其确为对象实例（编译通过即证明接口足以替换）。
    expect(typeof asInterface).toBe("object");
    expect(asInterface).toBeInstanceOf(StubProvider);
  });

  it("StubProvider 暴露全部 11 个 IDataProvider 方法且均返回 Promise<Result<T>>", async () => {
    const provider: IDataProvider = new StubProvider();

    // IDataProvider 声明的 11 个方法
    const methodNames: (keyof IDataProvider)[] = [
      "listDevices",
      "getDevice",
      "getAccountProfile",
      "updateAccountProfile",
      "getTodaySummary",
      "getWeeklyRecords",
      "listStrategies",
      "createStrategy",
      "updateStrategy",
      "deleteStrategy",
      "getMarketState",
    ];

    // 数量精确为 11
    expect(methodNames.length).toBe(11);

    // 运行时：每个方法存在且为函数
    for (const name of methodNames) {
      expect(typeof provider[name]).toBe("function");
    }

    // 运行时：以合法参数调用每个方法，断言返回 Promise 且解析为 Result<T>（含布尔 ok 字段）
    const validAccount: AccountProfileInput = STUB_ACCOUNT;
    const validStrategy: TradingStrategyInput = {
      name: "桩策略输入",
      action: "discharge",
      condition: { comparator: "less_than", priceThreshold: 2 },
      enabled: false,
    };

    const calls: Promise<Result<unknown>>[] = [
      provider.listDevices(),
      provider.getDevice("stub-device-001"),
      provider.getAccountProfile(),
      provider.updateAccountProfile(validAccount),
      provider.getTodaySummary(),
      provider.getWeeklyRecords(),
      provider.listStrategies(),
      provider.createStrategy(validStrategy),
      provider.updateStrategy("stub-strategy-001", { enabled: true }),
      provider.deleteStrategy("stub-strategy-001"),
      provider.getMarketState(),
    ];

    // 返回值必须均为 Promise
    for (const call of calls) {
      expect(call).toBeInstanceOf(Promise);
    }

    const results = await Promise.all(calls);
    expect(results.length).toBe(11);
    // 每个结果都符合 Result<T> 判别联合：ok 为布尔，成功含 data、失败含 error
    for (const result of results) {
      expect(typeof result.ok).toBe("boolean");
      if (result.ok) {
        expect("data" in result).toBe(true);
      } else {
        expect("error" in result).toBe(true);
      }
    }
  });
});

// ============================================================
// 3) 单用户约束（需求 6.4）
// ============================================================

describe("单用户约束：种子数据仅含单一账户（需求 6.4）", () => {
  it("createSeedData() 的 account 为单一账户对象而非集合", () => {
    const seed = createSeedData({ seed: 0x1234, now: Date.parse("2024-06-15T12:00:00.000Z") });

    // account 必须是「单一对象」，不得是数组/集合（注册上限 1）
    expect(Array.isArray(seed.account)).toBe(false);
    expect(typeof seed.account).toBe("object");
    expect(seed.account).not.toBeNull();

    // 该单一账户具备完整且为字符串的账户字段
    expect(typeof seed.account.name).toBe("string");
    expect(typeof seed.account.email).toBe("string");
    expect(typeof seed.account.phone).toBe("string");
    expect(typeof seed.account.address).toBe("string");

    // 种子数据结构中不存在「账户集合」字段（如 accounts/users），仅有单数 account
    const keys = Object.keys(seed as unknown as Record<string, unknown>);
    expect(keys).toContain("account");
    expect(keys).not.toContain("accounts");
    expect(keys).not.toContain("users");
  });

  it("不同设备/记录数量下，账户始终唯一（全部数据归属单一 User）", () => {
    const now = Date.parse("2024-06-15T12:00:00.000Z");
    // 覆盖不同规模：仍应只有一份账户
    for (const deviceCount of [0, 1, 5, 50]) {
      const seed = createSeedData({ seed: 0xabcd, now, deviceCount });
      // 仅一个账户对象（无法对单一对象“计数”，以非数组 + 字段完整间接保证唯一）
      expect(Array.isArray(seed.account)).toBe(false);
      expect(typeof seed.account.name).toBe("string");
      // 设备、策略、充放电记录均挂载于该唯一用户名下（结构上无第二用户维度）
      expect(Array.isArray(seed.devices)).toBe(true);
      expect(typeof seed.recordsByDevice).toBe("object");
      expect(Array.isArray(seed.strategies)).toBe(true);
    }
  });
});
