// 账户信息表单组件 AccountForm（任务 16.1，需求 2.1、2.6、2.7）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」要求：
//   - 挂载时 GET /api/account 预填表单；空字段显示为空（需求 2.1）。
//   - 提交时 PUT /api/account；权威校验在服务端（validation.ts）。
//   - 校验失败（VALIDATION）时显示对应字段错误（依据 error.field）并保留用户输入（需求 2.7）。
//   - 更新成功时显示成功提示并展示最新资料（需求 2.6）。
//
// 加载与错误统一复用共享的 LoadingState / ErrorState 组件；
// 失败时保留已有内容（错误横幅 + 既有表单），符合需求 6.6 的「保留内容 + 重试」约定。

"use client";

import { useCallback, useEffect, useState } from "react";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import { getJson, sendJson } from "@/lib/http/client";
import type { AccountProfile, DataError } from "@/lib/data-access/types";

// ============================================================
// 常量：字段定义与中文标签
// ============================================================

/** 账户字段键集合，固定四个字段（需求 2） */
type AccountFieldKey = keyof AccountProfile;

/** 表单字段的展示元数据：中文标签、占位符与是否多行 */
interface FieldMeta {
  /** 字段键，与 AccountProfile / error.field 对应 */
  key: AccountFieldKey;
  /** 中文标签 */
  label: string;
  /** 输入框占位提示 */
  placeholder: string;
  /** 是否使用多行文本域（地址较长） */
  multiline?: boolean;
  /** 输入类型（邮箱用 email，便于浏览器辅助；电话用 tel） */
  inputType?: string;
}

/** 四个账户字段的展示配置，顺序即渲染顺序 */
const FIELD_METAS: readonly FieldMeta[] = [
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

/** 空白账户资料：用于初始渲染与预填缺省（空字段显示为空，需求 2.1） */
const EMPTY_PROFILE: AccountProfile = {
  name: "",
  email: "",
  phone: "",
  address: "",
};

// ============================================================
// 组件实现
// ============================================================

/**
 * 账户信息表单组件。
 *
 * 行为概览：
 *   - 挂载时拉取当前账户资料用于预填（需求 2.1）。
 *   - 用户编辑后提交，调用 PUT /api/account 持久化。
 *   - 校验失败按 error.field 高亮对应字段错误并保留输入（需求 2.7）。
 *   - 成功后展示成功提示与最新资料（需求 2.6）。
 *
 * 返回:
 *   JSX.Element: 账户表单及其加载/错误/成功状态界面。
 */
export default function AccountForm(): JSX.Element {
  // 表单字段值（始终为受控组件，空字符串即显示为空）
  const [form, setForm] = useState<AccountProfile>(EMPTY_PROFILE);

  // 初始预填的加载态与加载错误（需求 2.1）
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<DataError | null>(null);

  // 提交中标志，避免重复提交
  const [submitting, setSubmitting] = useState<boolean>(false);

  // 校验失败时的字段错误（依据 error.field 定位，需求 2.7）
  const [fieldError, setFieldError] = useState<DataError | null>(null);

  // 非校验类的提交错误（如超时、来源错误）
  const [submitError, setSubmitError] = useState<DataError | null>(null);

  // 成功保存后的最新资料及成功提示（需求 2.6）
  const [savedProfile, setSavedProfile] = useState<AccountProfile | null>(null);

  /**
   * 拉取当前账户资料并预填表单（需求 2.1）。
   * 成功时用返回值填充各字段（缺失字段回退为空字符串）；失败时记录加载错误。
   */
  const loadProfile = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    const result = await getJson<AccountProfile>("/api/account");
    if (result.ok) {
      // 合并到空白模板，确保所有字段均为受控字符串（空字段显示为空）
      const profile = result.data ?? EMPTY_PROFILE;
      setForm({
        name: profile.name ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        address: profile.address ?? "",
      });
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, []);

  // 组件挂载时执行一次预填
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  /**
   * 更新单个字段值。
   * 任意编辑都会清空上一次的成功提示与提交错误，避免陈旧状态误导用户。
   *
   * 参数:
   *   key (AccountFieldKey): 被编辑的字段键
   *   value (string): 新的字段值
   */
  function handleChange(key: AccountFieldKey, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    // 编辑后清除成功提示与提交错误；若编辑的正是出错字段则清除其字段错误
    setSavedProfile(null);
    setSubmitError(null);
    setFieldError((prev) => (prev && prev.field === key ? null : prev));
  }

  /**
   * 提交账户资料：调用 PUT /api/account 更新。
   * 成功 → 记录最新资料并显示成功提示（需求 2.6）；
   * 校验失败 → 记录字段错误并保留用户输入（需求 2.7）；
   * 其他失败 → 显示通用错误提示（可经重试按钮再次调用）。
   */
  const submitProfile = useCallback(async (): Promise<void> => {
    // 进入提交态前清空上一次的提示与错误（保留用户输入 form 不变）
    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    setSavedProfile(null);

    const result = await sendJson<AccountProfile>("/api/account", "PUT", form);

    if (result.ok) {
      // 成功：以服务端返回的最新资料回填表单并展示（需求 2.6）
      const profile = result.data ?? form;
      setForm({
        name: profile.name ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        address: profile.address ?? "",
      });
      setSavedProfile(profile);
    } else if (result.error.type === "VALIDATION") {
      // 校验失败：记录字段错误（含 error.field），保留用户输入不重置（需求 2.7）
      setFieldError(result.error);
    } else {
      // 其他失败（超时 / 来源错误等）：显示通用错误提示
      setSubmitError(result.error);
    }
    setSubmitting(false);
  }, [form]);

  /**
   * 表单提交事件处理：阻止浏览器默认提交后委托给 submitProfile。
   *
   * 参数:
   *   event (React.FormEvent): 表单提交事件
   */
  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    void submitProfile();
  }

  // ——初始预填加载中：显示统一加载指示（需求 6.5）——
  if (loading) {
    return <LoadingState message="正在加载账户资料…" />;
  }

  // ——初始预填失败：显示错误 + 重试（需求 6.6）——
  if (loadError) {
    return <ErrorState message={loadError.message} onRetry={() => void loadProfile()} />;
  }

  return (
    <div className="account-form">
      {/* 成功提示与最新资料展示（需求 2.6） */}
      {savedProfile ? (
        <div className="account-form__success" role="status">
          <p className="account-form__success-text">账户资料已成功保存</p>
          <dl className="account-form__profile">
            {FIELD_METAS.map((meta) => (
              <div key={meta.key} className="account-form__profile-row">
                <dt className="account-form__profile-label">{meta.label}</dt>
                {/* 空字段以占位符「—」展示，避免空白歧义 */}
                <dd className="account-form__profile-value">
                  {savedProfile[meta.key] || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {/* 非校验类提交错误：错误横幅 + 重试（重新提交） */}
      {submitError ? (
        <ErrorState
          message={submitError.message}
          onRetry={() => void submitProfile()}
        />
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        {FIELD_METAS.map((meta) => {
          // 当前字段是否存在校验错误（依据 error.field 匹配，需求 2.7）
          const hasError =
            fieldError !== null && fieldError.field === meta.key;
          const errorId = `account-${meta.key}-error`;
          return (
            <div className="account-form__field" key={meta.key}>
              <label className="account-form__label" htmlFor={`account-${meta.key}`}>
                {meta.label}
              </label>
              {meta.multiline ? (
                <textarea
                  id={`account-${meta.key}`}
                  className={
                    hasError
                      ? "account-form__input account-form__input--error"
                      : "account-form__input"
                  }
                  value={form[meta.key]}
                  placeholder={meta.placeholder}
                  rows={3}
                  aria-invalid={hasError}
                  aria-describedby={hasError ? errorId : undefined}
                  onChange={(e) => handleChange(meta.key, e.target.value)}
                />
              ) : (
                <input
                  id={`account-${meta.key}`}
                  type={meta.inputType ?? "text"}
                  className={
                    hasError
                      ? "account-form__input account-form__input--error"
                      : "account-form__input"
                  }
                  value={form[meta.key]}
                  placeholder={meta.placeholder}
                  aria-invalid={hasError}
                  aria-describedby={hasError ? errorId : undefined}
                  onChange={(e) => handleChange(meta.key, e.target.value)}
                />
              )}
              {/* 字段级错误信息：role="alert" 即时播报（需求 2.7） */}
              {hasError ? (
                <p id={errorId} className="account-form__field-error" role="alert">
                  {fieldError.message}
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="account-form__actions">
          <button
            type="submit"
            className="account-form__submit"
            disabled={submitting}
          >
            {submitting ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
