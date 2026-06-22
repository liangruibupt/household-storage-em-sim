// 删除账户按钮 DeleteAccountButton（任务 21.21，需求 2.11、2.12、2.13、2.14）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」要求：
//   - DELETE /api/accounts/{id} 删除账户并级联移除其名下数据（服务端执行，需求 2.11）。
//   - 删除前需用户确认。
//   - 仅剩 1 个账户时服务端返回 LAST_ACCOUNT，提示"至少需保留 1 个账户"（需求 2.12）。
//   - 删除成功后回调父级刷新；若删除的是 Current_Account 且仍有其他账户，由父级经
//     AccountContext 自动切换到剩余账户之一并刷新各功能区（需求 2.13、6.6）。
//   - 接口错误显示错误提示（需求 2.14）。
//
// 架构约束（需求 5.1、5.4）：仅经 HTTP 客户端（sendJson）访问 /api/accounts/{id}，
// 不直接引用数据访问层或 Mock 实现。

"use client";

import { useCallback, useState } from "react";
import { sendJson } from "@/lib/http/client";
import type { DataError } from "@/lib/data-access/types";

/** 删除成功时服务端返回的数据结构（需求 2.11、2.13） */
interface DeleteResult {
  /** 被删除账户的标识 */
  id: string;
  /** 删除后剩余账户标识列表，供父级判断自动切换目标 */
  remainingAccountIds: string[];
}

// 删除账户按钮属性
export interface DeleteAccountButtonProps {
  /** 待删除账户的唯一标识 */
  accountId: string;
  /**
   * 删除成功回调（需求 2.11、2.13）。
   * 父级据此刷新账户列表（refreshAccounts）；若删除的是 Current_Account，
   * 上下文会在刷新时自动选定剩余账户之一为新的 Current_Account。
   *
   * 参数:
   *   result (DeleteResult): 被删 id 与剩余账户标识列表
   */
  onDeleted(result: DeleteResult): void;
}

/**
 * 删除账户按钮（含确认、上限提示与错误提示）。
 *
 * 参数:
 *   accountId (string): 待删除账户标识
 *   onDeleted ((result: DeleteResult) => void): 删除成功回调
 *
 * 返回:
 *   JSX.Element: 删除按钮及其错误/上限提示界面。
 */
export default function DeleteAccountButton({
  accountId,
  onDeleted,
}: DeleteAccountButtonProps): JSX.Element {
  // 删除中标志，避免重复提交
  const [deleting, setDeleting] = useState<boolean>(false);
  // 删除错误（含 LAST_ACCOUNT 上限提示，需求 2.12、2.14）
  const [error, setError] = useState<DataError | null>(null);

  /**
   * 执行删除：先确认，再调用 DELETE /api/accounts/{id}。
   * 成功 → 回调父级刷新与自动切换（需求 2.11、2.13）；
   * LAST_ACCOUNT → 提示"至少需保留 1 个账户"（需求 2.12）；
   * 其他失败 → 显示错误提示（需求 2.14）。
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    // 删除前确认，避免误操作
    const confirmed = window.confirm("确定删除该账户吗？该账户名下数据将一并删除。");
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    const result = await sendJson<DeleteResult>(
      `/api/accounts/${accountId}`,
      "DELETE"
    );

    if (result.ok) {
      // 删除成功：通知父级刷新列表并按需自动切换 Current_Account（需求 2.11、2.13）
      if (result.data) {
        onDeleted(result.data);
      }
    } else {
      // LAST_ACCOUNT（仅剩 1 个账户）或其他错误：显示对应提示（需求 2.12、2.14）
      setError(result.error);
    }
    setDeleting(false);
  }, [accountId, onDeleted]);

  return (
    <div className="delete-account">
      <button
        type="button"
        className="delete-account__button"
        onClick={() => void handleDelete()}
        disabled={deleting}
      >
        {deleting ? "删除中…" : "删除账户"}
      </button>
      {/* 错误提示：LAST_ACCOUNT 时展示"至少需保留 1 个账户"（需求 2.12、2.14） */}
      {error ? (
        <p className="delete-account__error" role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
