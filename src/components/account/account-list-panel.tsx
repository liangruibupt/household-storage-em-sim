// 账户列表面板 AccountListPanel（任务 21.21，需求 2.1、2.2、2.3）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」要求：
//   - AccountListPanel 渲染全部账户（≤5），每项展示唯一标识与姓名，
//     并对 Current_Account 呈现选中态标记（需求 2.1）。
//   - 无账户时显示"暂无账户"空状态并提供创建入口（需求 2.2）。
//   - 点击列表项即为 AccountSelect：将该账户设为 Current_Account（经 AccountContext），
//     由父级据 currentAccountId 加载该账户资料预填编辑表单（需求 2.3）。
//
// 本组件为受控展示组件：账户列表与当前选中标识由父级（账户页）经上下文取得后传入，
// 点击项时通过 onSelect 回调通知父级调用 setCurrentAccount，自身不直接访问数据来源。

"use client";

import type { Account } from "@/lib/data-access/types";

// 账户列表面板属性
export interface AccountListPanelProps {
  /** 全部账户列表（≤5，需求 2.1） */
  accounts: Account[];
  /** 当前选中账户（Current_Account）的标识；尚无选择时为 null */
  currentAccountId: string | null;
  /**
   * 选择某个账户的回调（AccountSelect，需求 2.3）。
   * 父级据此调用 AccountContext.setCurrentAccount(id)。
   *
   * 参数:
   *   id (string): 被选中账户的唯一标识
   */
  onSelect(id: string): void;
}

/**
 * 账户列表面板。
 *
 * 行为概览：
 *   - 列表为空：渲染"暂无账户"空状态提示（创建入口由父级在面板下方渲染，需求 2.2）。
 *   - 列表非空：逐项渲染账户的唯一标识与姓名，对 Current_Account 呈现选中态（需求 2.1）；
 *     点击项触发 onSelect，将其设为 Current_Account 并加载资料（需求 2.3）。
 *
 * 参数:
 *   accounts (Account[]): 账户列表
 *   currentAccountId (string | null): 当前选中账户标识
 *   onSelect ((id: string) => void): 选择账户回调
 *
 * 返回:
 *   JSX.Element: 账户列表或空状态提示。
 */
export default function AccountListPanel({
  accounts,
  currentAccountId,
  onSelect,
}: AccountListPanelProps): JSX.Element {
  // 空状态：显示"暂无账户"，不显示错误提示（需求 2.2）；创建入口由父级渲染
  if (accounts.length === 0) {
    return (
      <div className="account-list account-list--empty">
        <p className="account-list__empty-text">暂无账户</p>
        <p className="account-list__empty-hint">请通过下方表单创建第一个账户。</p>
      </div>
    );
  }

  return (
    <div className="account-list">
      {/* 列表以无障碍 listbox 语义呈现，单选选中态由 aria-selected 标注 */}
      <ul className="account-list__items" role="listbox" aria-label="账户列表">
        {accounts.map((account) => {
          // 当前账户是否为 Current_Account（选中态标记，需求 2.1）
          const selected = account.id === currentAccountId;
          return (
            <li key={account.id} className="account-list__item-wrapper">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={
                  selected
                    ? "account-list__item account-list__item--selected"
                    : "account-list__item"
                }
                onClick={() => onSelect(account.id)}
              >
                {/* 姓名空缺时以占位符「—」展示，避免空白歧义 */}
                <span className="account-list__name">
                  {account.profile.name || "—"}
                </span>
                <span className="account-list__id">{account.id}</span>
                {/* 文本化选中态标识，确保不依赖颜色也可区分 */}
                {selected ? (
                  <span className="account-list__badge">当前</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
