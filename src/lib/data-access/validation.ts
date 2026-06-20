// 纯函数校验器：账户资料与电力交易策略
//
// 本模块提供账户与策略的字段校验逻辑，供数据访问层（如 MockProvider 的
// updateAccountProfile / createStrategy）在写入内存态前调用。
//
// 设计要点：
// - 所有校验器均为「不抛异常」的纯函数，相同输入恒返回相同结果，便于属性测试（PBT）。
// - 返回值统一为 Result<T> 判别联合：校验通过返回 { ok: true, data }，
//   失败返回 { ok: false, error }，其中 error 为结构化 DataError，
//   type 恒为 "VALIDATION" 并通过 field 指明首个出错字段。
// - 校验器自身不修改任何外部状态，调用方在校验通过后方可持久化。
//
// 对应需求：2.3、2.4、2.5、4.8、4.9

import type {
  AccountProfile,
  AccountProfileInput,
  DataError,
  PriceComparator,
  Result,
  StrategyAction,
  TradingStrategyInput,
  TriggerCondition,
} from "./types";

// ============================================================
// 字段边界常量（单一事实来源）
// ============================================================

/** 姓名长度边界（需求 2.4）：1-50 字符 */
const NAME_MIN = 1;
const NAME_MAX = 50;

/** 邮箱最大长度（需求 2.3）：≤254 字符 */
const EMAIL_MAX = 254;

/** 电话长度边界（需求 2.5）：5-20 字符 */
const PHONE_MIN = 5;
const PHONE_MAX = 20;

/** 地址最大长度（需求 2.5）：≤200 字符 */
const ADDRESS_MAX = 200;

/** 策略名称长度边界（需求 4.8）：1-100 字符 */
const STRATEGY_NAME_MIN = 1;
const STRATEGY_NAME_MAX = 100;

/** 电价阈值边界（需求 4.9）：[0, 999999.99] */
const PRICE_THRESHOLD_MIN = 0;
const PRICE_THRESHOLD_MAX = 999999.99;

/**
 * 标准邮箱格式正则（需求 2.3）。
 * 要求形如 local@domain.tld：本地部分与域名部分均不含空白与 @，且域名含至少一个点。
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 电话允许字符正则（需求 2.5）：仅允许数字、加号、连字符与空格。
 */
const PHONE_PATTERN = /^[0-9+\-\s]+$/;

/** 合法策略动作枚举集合（需求 4.4） */
const STRATEGY_ACTIONS: readonly StrategyAction[] = [
  "charge",
  "discharge",
  "buy",
  "sell",
];

/** 合法电价比较关系枚举集合（需求 4.5） */
const PRICE_COMPARATORS: readonly PriceComparator[] = [
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "equal",
];

// ============================================================
// 内部辅助函数
// ============================================================

/** 构造一个 VALIDATION 类型的失败结果，并指明出错字段 */
function fail(field: string, message: string): { ok: false; error: DataError } {
  return { ok: false, error: { type: "VALIDATION", message, field } };
}

/** 判断值是否为字符串（防御性校验，避免运行时类型不符导致抛错） */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** 判断值是否为有限数值（排除 NaN、Infinity 与非数值类型） */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ============================================================
// 账户资料校验（需求 2.3、2.4、2.5）
// ============================================================

/**
 * 校验账户资料输入。
 *
 * 校验规则：
 * - 姓名（name）：必须为字符串且长度在 [1, 50] 之间（需求 2.4）。
 * - 邮箱（email）：必须符合标准邮箱格式且长度 ≤254（需求 2.3）。
 * - 电话（phone）：长度在 [5, 20] 之间且仅含 [0-9 + - 空格]（需求 2.5）。
 * - 地址（address）：长度 ≤200（需求 2.5）。
 *
 * 任一字段不合法即返回 VALIDATION 错误，并通过 field 指明首个出错字段；
 * 全部通过则返回携带原输入的成功结果。
 *
 * @param input 待校验的账户资料输入
 * @returns 校验通过返回 { ok: true, data }，否则返回 { ok: false, error }
 */
export function validateAccountProfile(
  input: AccountProfileInput
): Result<AccountProfile> {
  // —— 姓名校验（需求 2.4）——
  if (!isString(input.name) || input.name.length < NAME_MIN || input.name.length > NAME_MAX) {
    return fail("name", `姓名长度必须在 ${NAME_MIN} 至 ${NAME_MAX} 个字符之间`);
  }

  // —— 邮箱校验（需求 2.3）——
  if (!isString(input.email) || input.email.length > EMAIL_MAX || !EMAIL_PATTERN.test(input.email)) {
    return fail("email", `邮箱格式不正确，且长度不得超过 ${EMAIL_MAX} 个字符`);
  }

  // —— 电话校验（需求 2.5）——
  if (
    !isString(input.phone) ||
    input.phone.length < PHONE_MIN ||
    input.phone.length > PHONE_MAX ||
    !PHONE_PATTERN.test(input.phone)
  ) {
    return fail(
      "phone",
      `电话长度必须在 ${PHONE_MIN} 至 ${PHONE_MAX} 个字符之间，且仅可包含数字、加号、连字符与空格`
    );
  }

  // —— 地址校验（需求 2.5）——
  if (!isString(input.address) || input.address.length > ADDRESS_MAX) {
    return fail("address", `地址长度不得超过 ${ADDRESS_MAX} 个字符`);
  }

  // 全部字段通过校验，返回原输入
  return {
    ok: true,
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
    },
  };
}

// ============================================================
// 电力交易策略校验（需求 4.8、4.9）
// ============================================================

/**
 * 校验电力交易策略创建输入。
 *
 * 校验规则：
 * - 名称（name）：必须存在、为字符串且长度在 [1, 100] 之间（需求 4.8）。
 * - 动作（action）：必须存在且属于 charge/discharge/buy/sell 四种枚举之一（需求 4.4、4.8）。
 * - 触发条件（condition）：必须存在（需求 4.8）。
 * - 比较关系（condition.comparator）：必须属于五种枚举之一（需求 4.5、4.8）。
 * - 电价阈值（condition.priceThreshold）：必须为 [0, 999999.99] 范围内的有限数值（需求 4.9）。
 *
 * 任一必填字段缺失或不合法即返回 VALIDATION 错误，并通过 field 指明首个出错字段；
 * 全部通过则返回携带原输入的成功结果。
 *
 * @param input 待校验的策略创建输入
 * @returns 校验通过返回 { ok: true, data }，否则返回 { ok: false, error }
 */
export function validateTradingStrategyInput(
  input: TradingStrategyInput
): Result<TradingStrategyInput> {
  // —— 名称校验（需求 4.8）——
  if (
    !isString(input.name) ||
    input.name.length < STRATEGY_NAME_MIN ||
    input.name.length > STRATEGY_NAME_MAX
  ) {
    return fail(
      "name",
      `策略名称长度必须在 ${STRATEGY_NAME_MIN} 至 ${STRATEGY_NAME_MAX} 个字符之间`
    );
  }

  // —— 动作校验（需求 4.4、4.8）——
  if (!STRATEGY_ACTIONS.includes(input.action)) {
    return fail("action", "策略动作必须为 charge、discharge、buy 或 sell 之一");
  }

  // —— 触发条件存在性校验（需求 4.8）——
  const condition = input.condition as TriggerCondition | undefined | null;
  if (condition === undefined || condition === null || typeof condition !== "object") {
    return fail("condition", "策略缺少触发条件");
  }

  // —— 比较关系校验（需求 4.5、4.8）——
  if (!PRICE_COMPARATORS.includes(condition.comparator)) {
    return fail(
      "comparator",
      "比较关系必须为 greater_than、greater_or_equal、less_than、less_or_equal 或 equal 之一"
    );
  }

  // —— 电价阈值校验（需求 4.9）——
  if (
    !isFiniteNumber(condition.priceThreshold) ||
    condition.priceThreshold < PRICE_THRESHOLD_MIN ||
    condition.priceThreshold > PRICE_THRESHOLD_MAX
  ) {
    return fail(
      "priceThreshold",
      `电价阈值必须在 ${PRICE_THRESHOLD_MIN} 至 ${PRICE_THRESHOLD_MAX} 之间`
    );
  }

  // 全部字段通过校验，返回原输入
  return { ok: true, data: input };
}
