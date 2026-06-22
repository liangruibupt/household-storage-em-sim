// 架构约束与多账户校验测试（任务 21.25，需求 5.1、5.3、5.4、6.4）
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
//       并在运行时验证其全部方法存在且返回 Promise<Result<T>>。
//     - 该接口已演进为多账户作用域：包含账户管理方法（listAccounts/getAccount/createAccount/
//       updateAccountProfile(accountId)/deleteAccount），且设备/充放电/交易等数据方法均以
//       accountId 作为首个作用域参数。StubProvider 必须实现「当前」接口，以证明 API + UI
//       在替换为另一实现时仍可零改动编译/运行（需求 5.3）。
//
//  3) 多账户注册上限约束（需求 6.4）
//     - 平台支持最多 5 个账户：由 seed-data 导出的 MAX_ACCOUNTS 常量声明上限为 5，
//       且 createSeedData() 产出「账户集合」（而非单一账户对象），其数量被钳制到 [1, 5]。

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import type { IDataProvider } from "@/lib/data-access/provider";
import { getDataProvider } from "@/lib/data-access/factory";
import type {
  Result,
  Account,
  AccountProfile,
  AccountProfileInput,
  Device,
  DeviceDetail,
  DailySummary,
  ChargeDischargeRecord,
  TradingStrategy,
  TradingStrategyInput,
  TradingStrategyPatch,
  MarketState,
} from "@/lib/data-access/types";
// MAX_ACCOUNTS：平台账户注册数量上限常量（需求 2.5、6.4），用于断言上限为 5
import { createSeedData, MAX_ACCOUNTS } from "@/lib/data-access/mock/seed-data";

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
// 2) 可替换性：第二个 IDataProvider 桩实现（多账户作用域，需求 5.3）
// ============================================================

/** 桩账户标识：供账户作用域方法作为入参使用 */
const STUB_ACCOUNT_ID = "stub-account-001";

/** 预置的契约良构账户资料样例（字段均落在校验约束内） */
const STUB_PROFILE: AccountProfile = {
  name: "桩用户",
  email: "stub@example.com",
  phone: "+86 138-0000-0000",
  address: "示例地址 1 号",
};

/** 预置账户实体（id + profile，需求 2.4、6.4） */
const STUB_ACCOUNT: Account = {
  id: STUB_ACCOUNT_ID,
  profile: STUB_PROFILE,
};

// 预置的契约良构样例数据，供桩实现返回，保证返回结构符合各方法契约。
// 设备、记录、策略均带正确的 accountId 归属字段（多账户模型，需求 6.4）。
const STUB_DEVICE: Device = {
  id: "stub-device-001",
  accountId: STUB_ACCOUNT_ID,
  name: "桩设备 001",
  connectionStatus: "online",
  lastReportedAt: "2024-06-15T12:00:00.000Z",
};

const STUB_DEVICE_DETAIL: DeviceDetail = {
  ...STUB_DEVICE,
  lastStatusUpdatedAt: "2024-06-15T12:00:00Z",
};

const STUB_SUMMARY: DailySummary = {
  date: "2024-06-15",
  totalChargeKwh: 0,
  totalDischargeKwh: 0,
};

const STUB_STRATEGY: TradingStrategy = {
  id: "stub-strategy-001",
  accountId: STUB_ACCOUNT_ID,
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
 *
 * 该接口已演进为多账户作用域：账户管理方法（listAccounts/getAccount/createAccount/
 * updateAccountProfile(accountId)/deleteAccount）与以 accountId 为首参的数据方法均需实现。
 * 各方法均返回 Promise<Result<T>>，与接口契约一致。若接口签名变更而本桩未同步更新，
 * 则编译期 `implements IDataProvider` 即会报错，从而捕获契约漂移。
 */
class StubProvider implements IDataProvider {
  // -------- 账户方法（需求 2、6.4） --------

  async listAccounts(): Promise<Result<Account[]>> {
    return { ok: true, data: [STUB_ACCOUNT] };
  }

  async getAccount(accountId: string): Promise<Result<Account>> {
    return { ok: true, data: { ...STUB_ACCOUNT, id: accountId } };
  }

  async createAccount(input: AccountProfileInput): Promise<Result<Account>> {
    return { ok: true, data: { id: "stub-account-002", profile: input } };
  }

  async updateAccountProfile(
    accountId: string,
    input: AccountProfileInput
  ): Promise<Result<Account>> {
    return { ok: true, data: { id: accountId, profile: input } };
  }

  async deleteAccount(
    accountId: string
  ): Promise<Result<{ id: string; remainingAccountIds: string[] }>> {
    return { ok: true, data: { id: accountId, remainingAccountIds: [STUB_ACCOUNT_ID] } };
  }

  // -------- 设备方法（账户作用域，需求 1、6.5） --------

  async listDevices(_accountId: string): Promise<Result<Device[]>> {
    return { ok: true, data: [STUB_DEVICE] };
  }

  async getDevice(
    _accountId: string,
    deviceId: string
  ): Promise<Result<DeviceDetail>> {
    return { ok: true, data: { ...STUB_DEVICE_DETAIL, id: deviceId } };
  }

  // -------- 充放电方法（账户作用域，需求 3、6.5） --------

  async getTodaySummary(
    _accountId: string,
    _deviceId?: string
  ): Promise<Result<DailySummary>> {
    return { ok: true, data: STUB_SUMMARY };
  }

  async getWeeklyRecords(
    _accountId: string,
    _deviceId?: string
  ): Promise<Result<ChargeDischargeRecord[]>> {
    return { ok: true, data: [] };
  }

  // -------- 电力交易方法（账户作用域，需求 4、6.5） --------

  async listStrategies(_accountId: string): Promise<Result<TradingStrategy[]>> {
    return { ok: true, data: [STUB_STRATEGY] };
  }

  async createStrategy(
    accountId: string,
    input: TradingStrategyInput
  ): Promise<Result<TradingStrategy>> {
    return {
      ok: true,
      data: { ...STUB_STRATEGY, accountId, name: input.name, action: input.action },
    };
  }

  async updateStrategy(
    accountId: string,
    id: string,
    _patch: TradingStrategyPatch
  ): Promise<Result<TradingStrategy>> {
    return { ok: true, data: { ...STUB_STRATEGY, id, accountId } };
  }

  async deleteStrategy(
    _accountId: string,
    id: string
  ): Promise<Result<{ id: string }>> {
    return { ok: true, data: { id } };
  }

  async getMarketState(_accountId: string): Promise<Result<MarketState>> {
    return { ok: true, data: STUB_MARKET };
  }
}

describe("可替换性：第二个 IDataProvider 桩实现（多账户作用域，需求 5.3）", () => {
  it("StubProvider 可在类型层面赋值给 getDataProvider() 的返回类型", () => {
    // 类型层面：StubProvider 满足 IDataProvider，
    // 且可赋值给与 getDataProvider() 返回值同类型的变量（API 层注入点的类型）。
    const injected: ReturnType<typeof getDataProvider> = new StubProvider();
    const asInterface: IDataProvider = injected;
    // 运行时占位断言：确认其确为对象实例（编译通过即证明接口足以替换）。
    expect(typeof asInterface).toBe("object");
    expect(asInterface).toBeInstanceOf(StubProvider);
  });

  it("StubProvider 暴露全部 14 个 IDataProvider 方法且均返回 Promise<Result<T>>", async () => {
    const provider: IDataProvider = new StubProvider();

    // IDataProvider 声明的 14 个方法：账户 5 个 + 设备 2 个 + 充放电 2 个 + 交易 5 个
    const methodNames: (keyof IDataProvider)[] = [
      // 账户管理（需求 2、6.4）
      "listAccounts",
      "getAccount",
      "createAccount",
      "updateAccountProfile",
      "deleteAccount",
      // 设备（账户作用域）
      "listDevices",
      "getDevice",
      // 充放电（账户作用域）
      "getTodaySummary",
      "getWeeklyRecords",
      // 电力交易（账户作用域）
      "listStrategies",
      "createStrategy",
      "updateStrategy",
      "deleteStrategy",
      "getMarketState",
    ];

    // 数量精确为 14
    expect(methodNames.length).toBe(14);

    // 运行时：每个方法存在且为函数
    for (const name of methodNames) {
      expect(typeof provider[name]).toBe("function");
    }

    // 运行时：以合法参数调用每个方法，断言返回 Promise 且解析为 Result<T>（含布尔 ok 字段）
    const validAccount: AccountProfileInput = STUB_PROFILE;
    const validStrategy: TradingStrategyInput = {
      name: "桩策略输入",
      action: "discharge",
      condition: { comparator: "less_than", priceThreshold: 2 },
      enabled: false,
    };

    const calls: Promise<Result<unknown>>[] = [
      // 账户作用域方法均以 accountId 作为首参
      provider.listAccounts(),
      provider.getAccount(STUB_ACCOUNT_ID),
      provider.createAccount(validAccount),
      provider.updateAccountProfile(STUB_ACCOUNT_ID, validAccount),
      provider.deleteAccount(STUB_ACCOUNT_ID),
      provider.listDevices(STUB_ACCOUNT_ID),
      provider.getDevice(STUB_ACCOUNT_ID, "stub-device-001"),
      provider.getTodaySummary(STUB_ACCOUNT_ID),
      provider.getWeeklyRecords(STUB_ACCOUNT_ID),
      provider.listStrategies(STUB_ACCOUNT_ID),
      provider.createStrategy(STUB_ACCOUNT_ID, validStrategy),
      provider.updateStrategy(STUB_ACCOUNT_ID, "stub-strategy-001", { enabled: true }),
      provider.deleteStrategy(STUB_ACCOUNT_ID, "stub-strategy-001"),
      provider.getMarketState(STUB_ACCOUNT_ID),
    ];

    // 返回值必须均为 Promise
    for (const call of calls) {
      expect(call).toBeInstanceOf(Promise);
    }

    const results = await Promise.all(calls);
    expect(results.length).toBe(14);
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
// 3) 多账户注册上限约束（注册上限 5，需求 6.4）
// ============================================================

describe("多账户约束：账户注册上限为 5（需求 6.4）", () => {
  it("MAX_ACCOUNTS 常量声明平台账户注册上限为 5", () => {
    // 平台支持最多 5 个账户（由单用户的 1 改为多账户的 5）
    expect(MAX_ACCOUNTS).toBe(5);
  });

  it("createSeedData() 产出账户集合，且数量被钳制到 [1, MAX_ACCOUNTS]", () => {
    const now = Date.parse("2024-06-15T12:00:00.000Z");
    const seed = createSeedData({ seed: 0x1234, now });

    // 多账户模型：种子数据为「账户集合」（accounts 数组），而非单一 account 对象
    expect(Array.isArray(seed.accounts)).toBe(true);
    const keys = Object.keys(seed as unknown as Record<string, unknown>);
    expect(keys).toContain("accounts");
    // 旧的单账户字段不应再存在
    expect(keys).not.toContain("account");

    // 默认账户数量落在 [1, 5]
    expect(seed.accounts.length).toBeGreaterThanOrEqual(1);
    expect(seed.accounts.length).toBeLessThanOrEqual(MAX_ACCOUNTS);
  });

  it("请求超过上限的账户数时被钳制为 5（验证上限为 5 而非 1）", () => {
    const now = Date.parse("2024-06-15T12:00:00.000Z");
    // 请求 99 个账户，应被钳制到注册上限 5（而非单用户时代的 1）
    const over = createSeedData({ seed: 0x1234, now, accountCount: 99 });
    expect(over.accounts.length).toBe(MAX_ACCOUNTS);
    expect(over.accounts.length).toBe(5);

    // 每个账户具备唯一 id 与完整资料，且名下业务数据按 accountId 归属（需求 6.4、6.5）
    const ids = over.accounts.map((a) => a.account.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const seeded of over.accounts) {
      // 账户资料字段完整且为字符串
      expect(typeof seeded.account.id).toBe("string");
      expect(typeof seeded.account.profile.name).toBe("string");
      expect(typeof seeded.account.profile.email).toBe("string");
      expect(typeof seeded.account.profile.phone).toBe("string");
      expect(typeof seeded.account.profile.address).toBe("string");

      // 设备/策略数据归属于该账户（accountId 一致），体现多账户数据隔离
      for (const device of seeded.devices) {
        expect(device.accountId).toBe(seeded.account.id);
      }
      for (const strategy of seeded.strategies) {
        expect(strategy.accountId).toBe(seeded.account.id);
      }
    }
  });

  it("可种子化出恰好 5 个账户（上限边界）", () => {
    const now = Date.parse("2024-06-15T12:00:00.000Z");
    const atLimit = createSeedData({ seed: 0xabcd, now, accountCount: MAX_ACCOUNTS });
    expect(atLimit.accounts.length).toBe(5);
  });
});
