// 账户信息页面（任务 21.21，需求 2.1–2.14）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」：
//   账户页采用"账户列表 + 创建/编辑表单 + 删除"复合布局，统一消费 AccountContext
//   （useAccount）获取账户列表、Current_Account 与切换/刷新能力：
//     - AccountListPanel：展示全部账户（≤5）并标记 Current_Account；空时显示"暂无账户"（需求 2.1、2.2）。
//     - 点击列表项经 setCurrentAccount 设为 Current_Account 并预填编辑表单（需求 2.3）。
//     - CreateAccountForm：创建账户，达上限时禁用并提示（需求 2.4、2.5、2.10）。
//     - EditAccountForm：编辑 Current_Account 资料，成功/字段错误+保留输入（需求 2.6–2.10、2.14）。
//     - DeleteAccountButton：删除并确认；至少保留 1 个提示；删除 Current_Account 后自动切换（需求 2.11–2.14）。
//
// 本页面为客户端组件：数据获取与表单交互均在浏览器侧完成，仅经 HTTP 客户端访问 API，
// 不直接引用数据访问层或 Mock 实现（需求 5.1、5.4）。

"use client";

import { useCallback } from "react";
import LoadingState from "@/components/loading-state";
import ErrorState from "@/components/error-state";
import { useAccount } from "@/components/account/account-context";
import AccountListPanel from "@/components/account/account-list-panel";
import CreateAccountForm from "@/components/account/create-account-form";
import EditAccountForm from "@/components/account/edit-account-form";
import DeleteAccountButton from "@/components/account/delete-account-button";
import type { Account } from "@/lib/data-access/types";

/**
 * 账户信息页面。
 *
 * 行为概览：
 *   - 经 useAccount 读取账户列表、Current_Account 与加载/错误态（需求 2.1）。
 *   - 列表加载中显示加载指示；加载失败显示错误 + 重试并保留已有列表（需求 6.5、6.6）。
 *   - 选择列表项即设为 Current_Account 并加载其资料预填编辑表单（需求 2.3）。
 *   - 创建/更新/删除成功后经 refreshAccounts 刷新列表与各功能区（需求 2.10、2.13）。
 *
 * 返回:
 *   JSX.Element: 账户管理复合界面（列表 + 创建 + 编辑/删除）。
 */
export default function AccountPage(): JSX.Element {
  const {
    accounts,
    currentAccountId,
    loading,
    error,
    setCurrentAccount,
    refreshAccounts,
  } = useAccount();

  /**
   * 选择某账户为 Current_Account（AccountSelect，需求 2.3）。
   *
   * 参数:
   *   id (string): 被选中账户标识
   */
  const handleSelect = useCallback(
    (id: string): void => {
      setCurrentAccount(id);
    },
    [setCurrentAccount]
  );

  /**
   * 创建成功处理：刷新账户列表并将新账户设为 Current_Account（需求 2.10）。
   *
   * 参数:
   *   account (Account): 新创建的账户
   */
  const handleCreated = useCallback(
    (account: Account): void => {
      // 先刷新列表（使新账户进入列表，需求 2.10），再将其设为 Current_Account
      void refreshAccounts().then(() => {
        setCurrentAccount(account.id);
      });
    },
    [refreshAccounts, setCurrentAccount]
  );

  /**
   * 更新成功处理：刷新账户列表以同步姓名等列表展示（需求 2.10）。
   */
  const handleUpdated = useCallback((): void => {
    void refreshAccounts();
  }, [refreshAccounts]);

  /**
   * 删除成功处理：刷新账户列表（需求 2.11）。
   * 若删除的是 Current_Account，AccountContext 在刷新时会自动选定剩余账户之一为新的
   * Current_Account，并驱动各功能区在 3 秒内更新（需求 2.13、6.6）。
   */
  const handleDeleted = useCallback((): void => {
    void refreshAccounts();
  }, [refreshAccounts]);

  // ——账户列表加载中：显示统一加载指示（需求 6.5）——
  if (loading) {
    return (
      <section className="account-page">
        <h1 className="account-page__title">账户信息</h1>
        <LoadingState message="正在加载账户列表…" />
      </section>
    );
  }

  // ——账户列表加载失败：显示错误 + 重试，保留已有列表不清空（需求 6.6）——
  if (error) {
    return (
      <section className="account-page">
        <h1 className="account-page__title">账户信息</h1>
        <ErrorState
          message={error.message}
          onRetry={() => void refreshAccounts()}
        />
      </section>
    );
  }

  return (
    <section className="account-page">
      <h1 className="account-page__title">账户信息</h1>
      <p className="account-page__intro">
        管理最多 5 个账户：查看列表、创建、选择编辑与删除。
      </p>

      <div className="account-page__layout">
        {/* 左栏：账户列表（选中态/空状态）+ 创建表单（需求 2.1、2.2、2.4、2.5） */}
        <div className="account-page__sidebar">
          <AccountListPanel
            accounts={accounts}
            currentAccountId={currentAccountId}
            onSelect={handleSelect}
          />
          <CreateAccountForm
            accountCount={accounts.length}
            onCreated={handleCreated}
          />
        </div>

        {/* 右栏：编辑当前账户资料 + 删除（需求 2.3、2.6–2.14） */}
        <div className="account-page__main">
          {currentAccountId ? (
            <>
              {/* key 绑定 accountId：切换账户时重建表单，确保按新账户重新预填（需求 2.3） */}
              <EditAccountForm
                key={currentAccountId}
                accountId={currentAccountId}
                onUpdated={handleUpdated}
              />
              <DeleteAccountButton
                key={`delete-${currentAccountId}`}
                accountId={currentAccountId}
                onDeleted={handleDeleted}
              />
            </>
          ) : (
            // 无账户时不展示编辑区，仅提示经左栏创建（需求 2.2）
            <p className="account-page__no-selection">
              暂无可编辑的账户，请先在左侧创建账户。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
