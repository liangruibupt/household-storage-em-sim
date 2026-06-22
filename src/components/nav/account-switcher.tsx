// 导航区账户切换器 AccountSwitcher（任务 21.20，需求 2.1、2.3、6.4、6.6）
//
// 设计文档「Current_Account 选择与传递」与「应用框架与导航」要求：
//   - 常驻导航区，展示账户列表（≤5）并标记 Current_Account（需求 6.4）。
//   - 用户选择某账户即调用 AccountContext.setCurrentAccount(id)，触发各功能区在 3 秒内
//     重新拉取该账户名下数据（需求 2.3、6.6）。
//
// 本组件仅消费 AccountContext，不直接发起数据请求；账户列表来源与切换语义统一由上下文维护。

"use client";

import { useAccount } from "@/components/account/account-context";

/**
 * 导航区账户切换器。
 *
 * 渲染规则：
 *   - 账户加载中且尚无账户：显示精简加载文案，保持导航始终可见（需求 6.2、6.7）。
 *   - 无账户：显示「暂无账户」占位（需求 2.2 的空态由账户页承载，此处仅作切换器占位）。
 *   - 有账户：以下拉选择器展示账户列表（≤5），当前值即 Current_Account（需求 6.4）。
 *
 * 返回:
 *   JSX.Element: 含账户下拉选择的切换器控件。
 */
export default function AccountSwitcher(): JSX.Element {
  const { accounts, currentAccountId, loading, setCurrentAccount } =
    useAccount();

  // 账户尚未就绪（首次加载且列表为空）：显示精简加载提示，导航保持可见
  if (loading && accounts.length === 0) {
    return (
      <div className="account-switcher" aria-busy="true">
        <span className="account-switcher__hint">账户加载中…</span>
      </div>
    );
  }

  // 无账户：显示占位（创建入口由账户页提供，需求 2.2）
  if (accounts.length === 0) {
    return (
      <div className="account-switcher">
        <span className="account-switcher__hint">暂无账户</span>
      </div>
    );
  }

  return (
    <div className="account-switcher">
      <label className="account-switcher__label" htmlFor="account-switcher-select">
        当前账户
      </label>
      <select
        id="account-switcher-select"
        className="account-switcher__select"
        // 当前值绑定 Current_Account；无选中时回退为空串
        value={currentAccountId ?? ""}
        // 选择某账户即切换 Current_Account（需求 2.3、6.6）
        onChange={(event) => setCurrentAccount(event.target.value)}
        aria-label="选择当前账户"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {/* 以账户姓名为主、附唯一标识，便于在重名时区分 */}
            {account.profile.name || "（未命名账户）"}
          </option>
        ))}
      </select>
    </div>
  );
}
