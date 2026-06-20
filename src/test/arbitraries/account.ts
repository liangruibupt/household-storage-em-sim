// 账户资料输入的 fast-check 生成器（Arbitrary）
//
// 本模块提供「合法」与「非法」账户输入的生成器，供账户校验属性测试使用。
// 设计要点：
// - 非法生成器每次只破坏「恰好一个」字段，并携带 expectedField 标注，
//   使属性测试可断言 validateAccountProfile 报告的出错字段精确匹配。
// - 重点覆盖设计文档与任务要求的边界：长度 0/1/50/51/254/255、
//   非法字符、缺少 "@" 的邮箱。
//
// 对应需求：2.3、2.4、2.5（Property 5）

import fc from "fast-check";
import type { AccountProfileInput } from "@/lib/data-access/types";

// ============================================================
// 字符集与定长字符串辅助
// ============================================================

/** 邮箱本地/域名部分可用的安全字符集：不含空白、"@" 与 "." */
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 电话合法字符集（需求 2.5）：数字、加号、连字符与空格 */
const PHONE_CHARS = "0123456789+- ";

/** 从给定字符集中取单个字符的 Arbitrary */
function charFrom(chars: string): fc.Arbitrary<string> {
  return fc.constantFrom(...chars.split(""));
}

/** 生成由指定字符集、长度落在 [min, max] 的字符串 */
function stringOfLen(chars: string, min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(charFrom(chars), { minLength: min, maxLength: max })
    .map((arr) => arr.join(""));
}

/** 生成恰好 n 个字符 'a' 的字符串（用于精确边界长度构造） */
function repeat(n: number): string {
  return "a".repeat(n);
}

// ============================================================
// 合法字段生成器
// ============================================================

/** 合法姓名（需求 2.4）：长度 [1, 50]，偏重边界 1/50 */
const validName: fc.Arbitrary<string> = fc.oneof(
  fc.constant(repeat(1)), // 下边界
  fc.constant(repeat(50)), // 上边界
  fc.string({ minLength: 1, maxLength: 50 })
);

/** 合法邮箱（需求 2.3）：标准格式且长度 ≤254，包含一个恰为上界 254 的样例 */
const validEmail: fc.Arbitrary<string> = fc.oneof(
  // 恰为上界：长度 254 的合法邮箱（249 + "@" + "e" + "." + "co" = 254）
  fc.constant(`${repeat(249)}@e.co`),
  fc
    .tuple(
      stringOfLen(ALNUM, 1, 12),
      stringOfLen(ALNUM, 1, 12),
      stringOfLen(ALNUM, 2, 4)
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
);

/** 合法电话（需求 2.5）：长度 [5, 20] 且仅含合法字符 */
const validPhone: fc.Arbitrary<string> = stringOfLen(PHONE_CHARS, 5, 20);

/** 合法地址（需求 2.5）：长度 [0, 200] */
const validAddress: fc.Arbitrary<string> = fc.string({ maxLength: 200 });

/** 合法账户资料输入：所有字段均通过校验 */
export const validAccountProfile: fc.Arbitrary<AccountProfileInput> = fc.record({
  name: validName,
  email: validEmail,
  phone: validPhone,
  address: validAddress,
});

// ============================================================
// 非法字段生成器（每次只破坏一个字段）
// ============================================================

/** 非法姓名（需求 2.4）：空（长度 0）或超长（长度 51+） */
const invalidName: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""), // 长度 0
  fc.constant(repeat(51)), // 长度 51（刚越上界）
  fc.string({ minLength: 51, maxLength: 80 })
);

/** 非法邮箱（需求 2.3）：缺少 "@"，或长度 >254（255+） */
const invalidEmail: fc.Arbitrary<string> = fc.oneof(
  // 缺少 "@" 的非空字符串（不含空白与 "@"，必然不匹配邮箱格式）
  stringOfLen(ALNUM, 1, 30),
  // 长度恰为 255 的格式合法但超长的邮箱（250 + "@" + "e" + "." + "co" = 255）
  fc.constant(`${repeat(250)}@e.co`),
  // 长度 >255 的超长邮箱
  fc.constant(`${repeat(300)}@e.co`)
);

/** 非法电话（需求 2.5）：长度越界（<5 或 >20），或含非法字符 */
const invalidPhone: fc.Arbitrary<string> = fc.oneof(
  // 长度 < 5（含空串）
  stringOfLen(PHONE_CHARS, 0, 4),
  // 长度 > 20
  stringOfLen(PHONE_CHARS, 21, 30),
  // 长度合法但含非法字符（插入一个字母）
  stringOfLen(PHONE_CHARS, 4, 19).map((s) => `${s}x`)
);

/** 非法地址（需求 2.5）：长度 >200（201+） */
const invalidAddress: fc.Arbitrary<string> = fc.oneof(
  fc.constant(repeat(201)), // 刚越上界
  fc.string({ minLength: 201, maxLength: 260 })
);

// ============================================================
// 组合：破坏单一字段的非法账户输入
// ============================================================

/** 非法账户输入及其期望报告的出错字段 */
export interface InvalidAccountCase {
  input: AccountProfileInput;
  expectedField: "name" | "email" | "phone" | "address";
}

/**
 * 生成「恰好一个字段非法、其余字段合法」的账户输入。
 *
 * 由于 validateAccountProfile 的校验顺序为 name → email → phone → address，
 * 在仅破坏单一字段时，其报告的 field 必然等于被破坏的字段，
 * 因此可据此精确断言 error.field === expectedField。
 */
export const invalidAccountProfile: fc.Arbitrary<InvalidAccountCase> = fc.oneof(
  // 仅姓名非法
  fc
    .record({ name: invalidName, email: validEmail, phone: validPhone, address: validAddress })
    .map((input) => ({ input, expectedField: "name" as const })),
  // 仅邮箱非法
  fc
    .record({ name: validName, email: invalidEmail, phone: validPhone, address: validAddress })
    .map((input) => ({ input, expectedField: "email" as const })),
  // 仅电话非法
  fc
    .record({ name: validName, email: validEmail, phone: invalidPhone, address: validAddress })
    .map((input) => ({ input, expectedField: "phone" as const })),
  // 仅地址非法
  fc
    .record({ name: validName, email: validEmail, phone: validPhone, address: invalidAddress })
    .map((input) => ({ input, expectedField: "address" as const }))
);
