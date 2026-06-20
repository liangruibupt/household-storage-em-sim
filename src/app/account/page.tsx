// 账户信息页面（任务 16.1，需求 2.1、2.6、2.7）
//
// 设计文档「各功能区组件设计 / 3. 账户信息管理」：
//   AccountPage 渲染 AccountForm；表单负责 GET /api/account 预填与 PUT /api/account 提交，
//   成功显示成功提示与最新资料，校验失败显示字段错误并保留输入。
//
// 本页面为客户端组件（数据获取与表单交互均在浏览器侧完成）。

"use client";

import AccountForm from "@/components/account/account-form";

/**
 * 账户信息页面。
 *
 * 返回:
 *   JSX.Element: 页面标题与账户信息表单。
 */
export default function AccountPage(): JSX.Element {
  return (
    <section className="account-page">
      <h1 className="account-page__title">账户信息</h1>
      <p className="account-page__intro">查看并更新您的账户资料。</p>
      <AccountForm />
    </section>
  );
}
