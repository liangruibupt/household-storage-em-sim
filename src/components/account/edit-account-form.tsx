// 编辑账户表单 EditAccountForm（任务 21.21，需求 2.3、2.6、2.7、2.8、2.9、2.10、2.14）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」要求：
//   - 据 Current_Account 标识经 GET /api/accounts/{id} 预填资料；空字段显示为空（需求 2.3）。
//   - PUT /api/accounts/{id} 更新该账户资料；权威校验在服务端（validation.ts），
//     不影响其他账户（需求 2.6）。
//   - 更新成功显示成功提示并展示最新资料，同时刷新账户列表（需求 2.6、2.10）。
//   - 校验失败（VALIDATION）显示对应字段错误并保留用户输入（需求 2.7–2.9、2.14）。
//   - 其他接口错误显示错误提示并保留输入（需求 2.14）。
//
// 架构约束（需求 5.1、5.4）：仅经 HTTP 客户端（getJson/sendJson）访问 /api/accounts/{id}，
// 不直接引用数据访问层或 Mock 实现。

"use client";

import { useCallback, useEffect, useState } from "react";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import { getJson, sendJson } from "@/lib/http/client";
import type { Account, AccountProfile, DataError } from "@/lib/data-access/types";
import {
  FIELD_METAS,
  EMPTY_PROFILE,
  normalizeProfile,
  type AccountFieldKey,
} from "./account-fields";

// 编辑账户表单属性
export interface EditAccountFormProps {
  /** 当前编辑的账户标识（Current_Account，需求 2.3） */
  accountId: string;
  /**
   * 更新成功回调：父级据此刷新账户列表（姓名变更需同步到列表，需求 2.10）。
   *
   * 参数:
   *   account (Account): 服务端返回的最新账户
   */
  onUpdated(account: Account): void;
}

/**
 * 编辑账户表单。
 *
 * 行为概览：
 *   - accountId 变化时经 GET /api/accounts/{id} 重新预填资料（需求 2.3）。
 *   - 提交调用 PUT /api/accounts/{id}；成功展示最新资料与成功提示并刷新列表（需求 2.6、2.10）；
 *     校验失败按 error.field 高亮并保留输入（需求 2.7–2.9）；其他错误保留输入并提示（需求 2.14）。
 *
 * 参数:
 *   accountId (string): 当前编辑账户标识
 *   onUpdated ((account: Account) => void): 更新成功回调
 *
 * 返回:
 *   JSX.Element: 账户编辑表单及其加载/错误/成功状态界面。
 */
export default function EditAccountForm({
  accountId,
  onUpdated,
}: EditAccountFormProps): JSX.Element {
  // 表单字段值（始终为受控组件，空字符串即显示为空）
  const [form, setForm] = useState<AccountProfile>(EMPTY_PROFILE);

  // 预填的加载态与加载错误（需求 2.3）
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<DataError | null>(null);

  // 提交中标志，避免重复提交
  const [submitting, setSubmitting] = useState<boolean>(false);

  // 校验失败时的字段错误（依据 error.field 定位，需求 2.7–2.9）
  const [fieldError, setFieldError] = useState<DataError | null>(null);

  // 非校验类的提交错误（如超时、来源错误，需求 2.14）
  const [submitError, setSubmitError] = useState<DataError | null>(null);

  // 成功保存后的最新资料及成功提示（需求 2.6、2.10）
  const [savedProfile, setSavedProfile] = useState<AccountProfile | null>(null);

  /**
   * 据 accountId 拉取账户资料并预填表单（需求 2.3）。
   * 成功时用返回值填充各字段（缺失字段回退为空字符串）；失败时记录加载错误。
   */
  const loadProfile = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    // 切换账户时清空上一账户残留的提示与错误
    setFieldError(null);
    setSubmitError(null);
    setSavedProfile(null);

    const result = await getJson<Account>(`/api/accounts/${accountId}`);
    if (result.ok) {
      // 规整为受控字符串字段，确保空字段显示为空（需求 2.3）
      setForm(normalizeProfile(result.data?.profile));
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, [accountId]);

  // accountId 变化（含首次挂载与切换 Current_Account）时重新预填
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  /**
   * 更新单个字段值。
   * 任意编辑都会清除上一次的成功提示与提交错误；若编辑的正是出错字段则清除其字段错误。
   *
   * 参数:
   *   key (AccountFieldKey): 被编辑的字段键
   *   value (string): 新的字段值
   */
  function handleChange(key: AccountFieldKey, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedProfile(null);
    setSubmitError(null);
    setFieldError((prev) => (prev && prev.field === key ? null : prev));
  }

  /**
   * 提交账户资料：调用 PUT /api/accounts/{id} 更新。
   * 成功 → 记录最新资料、显示成功提示并回调父级刷新列表（需求 2.6、2.10）；
   * 校验失败 → 记录字段错误并保留用户输入（需求 2.7–2.9、2.14）；
   * 其他失败 → 显示通用错误提示并保留输入（需求 2.14）。
   */
  const submitProfile = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    setSavedProfile(null);

    const result = await sendJson<Account>(
      `/api/accounts/${accountId}`,
      "PUT",
      form
    );

    if (result.ok) {
      // 成功：以服务端返回的最新资料回填表单并展示（需求 2.6、2.10）
      const profile = normalizeProfile(result.data?.profile ?? form);
      setForm(profile);
      setSavedProfile(profile);
      // 通知父级刷新列表（姓名变更需同步到列表，需求 2.10）
      if (result.data) {
        onUpdated({ id: result.data.id, profile });
      }
    } else if (result.error.type === "VALIDATION") {
      // 校验失败：记录字段错误，保留用户输入不重置（需求 2.7–2.9、2.14）
      setFieldError(result.error);
    } else {
      // 其他失败（超时 / 来源错误等）：显示通用错误提示并保留输入（需求 2.14）
      setSubmitError(result.error);
    }
    setSubmitting(false);
  }, [accountId, form, onUpdated]);

  /**
   * 表单提交事件处理：阻止浏览器默认提交后委托给 submitProfile。
   *
   * 参数:
   *   event (React.FormEvent): 表单提交事件
   */
  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (submitting) {
      return;
    }
    void submitProfile();
  }

  // ——预填加载中：显示统一加载指示（需求 6.5）——
  if (loading) {
    return <LoadingState message="正在加载账户资料…" />;
  }

  // ——预填失败：显示错误 + 重试（需求 6.6）——
  if (loadError) {
    return (
      <ErrorState message={loadError.message} onRetry={() => void loadProfile()} />
    );
  }

  return (
    <div className="account-form edit-account-form">
      <h2 className="edit-account-form__title">编辑账户资料</h2>

      {/* 成功提示与最新资料展示（需求 2.6、2.10） */}
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

      {/* 非校验类提交错误：错误横幅 + 重试（重新提交，需求 2.14） */}
      {submitError ? (
        <ErrorState
          message={submitError.message}
          onRetry={() => void submitProfile()}
        />
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        {FIELD_METAS.map((meta) => {
          // 当前字段是否存在校验错误（依据 error.field 匹配，需求 2.7–2.9）
          const hasError = fieldError !== null && fieldError.field === meta.key;
          const errorId = `edit-account-${meta.key}-error`;
          return (
            <div className="account-form__field" key={meta.key}>
              <label
                className="account-form__label"
                htmlFor={`edit-account-${meta.key}`}
              >
                {meta.label}
              </label>
              {meta.multiline ? (
                <textarea
                  id={`edit-account-${meta.key}`}
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
                  id={`edit-account-${meta.key}`}
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
              {/* 字段级错误信息：role="alert" 即时播报（需求 2.7–2.9） */}
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
