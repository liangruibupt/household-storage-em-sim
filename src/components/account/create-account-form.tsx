// 创建账户表单 CreateAccountForm（任务 21.21，需求 2.4、2.5、2.10、2.14）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」要求：
//   - POST /api/accounts 创建新账户（需求 2.4）。
//   - 当账户数已达 5 时，入口禁用且提示"账户数量已达上限 5 个"；若提交仍返回
//     ACCOUNT_LIMIT，同样展示该上限提示（需求 2.5）。
//   - 创建成功时显示成功提示，并经上下文刷新账户列表（需求 2.10）。
//   - 校验失败（VALIDATION）显示对应字段错误并保留用户输入（需求 2.7–2.9、2.14）。
//   - 其他接口错误显示错误提示并保留输入（需求 2.14）。
//
// 架构约束（需求 5.1、5.4）：仅经 HTTP 客户端（sendJson）访问 /api/accounts，
// 不直接引用数据访问层或 Mock 实现。

"use client";

import { useCallback, useState } from "react";
import { sendJson } from "@/lib/http/client";
import type { Account, AccountProfile, DataError } from "@/lib/data-access/types";
import {
  FIELD_METAS,
  EMPTY_PROFILE,
  normalizeProfile,
  type AccountFieldKey,
} from "./account-fields";

/** 账户数量上限（需求 2.5、6.4） */
const ACCOUNT_LIMIT = 5;

// 创建账户表单属性
export interface CreateAccountFormProps {
  /** 当前账户数量，用于在已达上限时禁用入口（需求 2.5） */
  accountCount: number;
  /**
   * 创建成功回调：父级据此刷新账户列表（refreshAccounts），可选择将新账户设为
   * Current_Account（需求 2.10、2.13）。
   *
   * 参数:
   *   account (Account): 服务端返回的新账户
   */
  onCreated(account: Account): void;
}

/**
 * 创建账户表单。
 *
 * 参数:
 *   accountCount (number): 当前账户数量
 *   onCreated ((account: Account) => void): 创建成功回调
 *
 * 返回:
 *   JSX.Element: 创建表单及其上限提示/成功提示/错误提示界面。
 */
export default function CreateAccountForm({
  accountCount,
  onCreated,
}: CreateAccountFormProps): JSX.Element {
  // 表单字段值（受控组件，空字符串即显示为空）
  const [form, setForm] = useState<AccountProfile>(EMPTY_PROFILE);
  // 提交中标志，避免重复提交
  const [submitting, setSubmitting] = useState<boolean>(false);
  // 校验失败的字段错误（依据 error.field 定位，需求 2.7–2.9）
  const [fieldError, setFieldError] = useState<DataError | null>(null);
  // 非校验类提交错误（上限、超时、来源错误等，需求 2.5、2.14）
  const [submitError, setSubmitError] = useState<DataError | null>(null);
  // 创建成功提示文本（需求 2.10）
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 是否已达账户数量上限（需求 2.5）：达上限则禁用提交并展示上限提示
  const atLimit = accountCount >= ACCOUNT_LIMIT;

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
    setSuccessMessage(null);
    setSubmitError(null);
    setFieldError((prev) => (prev && prev.field === key ? null : prev));
  }

  /**
   * 提交创建：调用 POST /api/accounts。
   * 成功 → 重置表单、显示成功提示并回调父级刷新（需求 2.4、2.10）；
   * ACCOUNT_LIMIT → 显示上限提示（需求 2.5）；
   * VALIDATION → 字段错误并保留输入（需求 2.7–2.9、2.14）；
   * 其他失败 → 通用错误提示并保留输入（需求 2.14）。
   */
  const submitCreate = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    setSuccessMessage(null);

    const result = await sendJson<Account>("/api/accounts", "POST", form);

    if (result.ok) {
      // 创建成功：清空表单、显示成功提示，并通知父级刷新列表（需求 2.10）
      setForm(EMPTY_PROFILE);
      setSuccessMessage("账户创建成功");
      // result.data 理论上为新账户；防御性规整资料字段后回调
      if (result.data) {
        onCreated({
          id: result.data.id,
          profile: normalizeProfile(result.data.profile),
        });
      }
    } else if (result.error.type === "VALIDATION") {
      // 校验失败：记录字段错误，保留用户输入（需求 2.7–2.9、2.14）
      setFieldError(result.error);
    } else {
      // ACCOUNT_LIMIT / 超时 / 来源错误等：显示错误提示并保留输入（需求 2.5、2.14）
      setSubmitError(result.error);
    }
    setSubmitting(false);
  }, [form, onCreated]);

  /**
   * 表单提交事件处理：阻止默认提交后委托给 submitCreate。
   * 已达上限时直接拦截不提交（需求 2.5）。
   *
   * 参数:
   *   event (React.FormEvent): 表单提交事件
   */
  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (atLimit || submitting) {
      return;
    }
    void submitCreate();
  }

  return (
    <div className="create-account-form">
      <h2 className="create-account-form__title">创建账户</h2>

      {/* 已达上限提示（需求 2.5）：禁用提交并明确告知上限 */}
      {atLimit ? (
        <p className="create-account-form__limit" role="alert">
          账户数量已达上限 {ACCOUNT_LIMIT} 个
        </p>
      ) : null}

      {/* 创建成功提示（需求 2.10） */}
      {successMessage ? (
        <p className="create-account-form__success" role="status">
          {successMessage}
        </p>
      ) : null}

      {/* 非校验类错误提示（含 ACCOUNT_LIMIT，需求 2.5、2.14） */}
      {submitError ? (
        <p className="create-account-form__error" role="alert">
          {submitError.message}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        {FIELD_METAS.map((meta) => {
          // 当前字段是否存在校验错误（依据 error.field 匹配，需求 2.7–2.9）
          const hasError = fieldError !== null && fieldError.field === meta.key;
          const errorId = `create-account-${meta.key}-error`;
          return (
            <div className="account-form__field" key={meta.key}>
              <label
                className="account-form__label"
                htmlFor={`create-account-${meta.key}`}
              >
                {meta.label}
              </label>
              {meta.multiline ? (
                <textarea
                  id={`create-account-${meta.key}`}
                  className={
                    hasError
                      ? "account-form__input account-form__input--error"
                      : "account-form__input"
                  }
                  value={form[meta.key]}
                  placeholder={meta.placeholder}
                  rows={3}
                  disabled={atLimit}
                  aria-invalid={hasError}
                  aria-describedby={hasError ? errorId : undefined}
                  onChange={(e) => handleChange(meta.key, e.target.value)}
                />
              ) : (
                <input
                  id={`create-account-${meta.key}`}
                  type={meta.inputType ?? "text"}
                  className={
                    hasError
                      ? "account-form__input account-form__input--error"
                      : "account-form__input"
                  }
                  value={form[meta.key]}
                  placeholder={meta.placeholder}
                  disabled={atLimit}
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
            disabled={submitting || atLimit}
          >
            {submitting ? "创建中…" : "创建账户"}
          </button>
        </div>
      </form>
    </div>
  );
}
