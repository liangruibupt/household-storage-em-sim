// 账户字段共享配置（任务 21.21，需求 2.3、2.7、2.8、2.9）
//
// 创建表单（CreateAccountForm）与编辑表单（EditAccountForm）共用同一套字段元数据
// 与规整工具，避免重复定义并保持中文标签、占位符与校验字段键（error.field）一致。
// 本模块为纯数据/工具（无 JSX），因此以 .ts 形式提供。

import type { AccountProfile } from "@/lib/data-access/types";

/** 账户字段键集合，固定四个字段（需求 2） */
export type AccountFieldKey = keyof AccountProfile;

/** 表单字段的展示元数据：中文标签、占位符与是否多行 */
export interface FieldMeta {
  /** 字段键，与 AccountProfile / error.field 对应 */
  key: AccountFieldKey;
  /** 中文标签 */
  label: string;
  /** 输入框占位提示 */
  placeholder: string;
  /** 是否使用多行文本域（地址较长） */
  multiline?: boolean;
  /** 输入类型（邮箱用 email，电话用 tel，便于浏览器辅助） */
  inputType?: string;
}

/** 四个账户字段的展示配置，顺序即渲染顺序 */
export const FIELD_METAS: readonly FieldMeta[] = [
  { key: "name", label: "姓名", placeholder: "请输入姓名（1-50 字符）" },
  {
    key: "email",
    label: "邮箱",
    placeholder: "请输入邮箱地址",
    inputType: "email",
  },
  {
    key: "phone",
    label: "电话",
    placeholder: "请输入电话（仅数字、空格、+、-）",
    inputType: "tel",
  },
  {
    key: "address",
    label: "地址",
    placeholder: "请输入地址（≤200 字符，可留空）",
    multiline: true,
  },
];

/** 空白账户资料：用于初始渲染与预填缺省（空字段显示为空，需求 2.3） */
export const EMPTY_PROFILE: AccountProfile = {
  name: "",
  email: "",
  phone: "",
  address: "",
};

/**
 * 将任意（可能含缺失字段）的账户资料规整为四个受控字符串字段。
 * 缺失或 null/undefined 字段回退为空字符串，确保受控组件不报错且空字段显示为空（需求 2.3）。
 *
 * 参数:
 *   profile (Partial<AccountProfile> | null | undefined): 原始账户资料
 *
 * 返回:
 *   AccountProfile: 四字段均为字符串的规整结果
 */
export function normalizeProfile(
  profile: Partial<AccountProfile> | null | undefined
): AccountProfile {
  return {
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
  };
}
