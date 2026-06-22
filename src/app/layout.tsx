import type { Metadata } from "next";
import type { ReactNode } from "react";
import NavBar from "@/components/nav-bar";
import { AccountProvider } from "@/components/account/account-context";
import "./globals.css";

// 应用级元数据：标题与描述
export const metadata: Metadata = {
  title: "家庭储能能源管理平台",
  description: "管理家庭储能设备、账户信息、充放电数据与智能电力交易策略",
};

// 全局布局：以 <AccountProvider> 包裹常驻导航与所有页面内容（需求 6.1、6.2、6.4）。
// AccountProvider 提供 currentAccountId 共享状态，导航区的 AccountSwitcher 与各功能页
// 均从中读取 Current_Account；切换账户后三大功能区据 currentAccountId 重新拉取（需求 6.6）。
// NavBar 使用 CSS sticky 定位（见 globals.css），滚动时保持置顶可见、不被遮挡。
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AccountProvider>
          {/* 常驻导航：始终位于页面顶部，含四个固定入口与账户切换器 */}
          <NavBar />
          {/* 页面主内容区域 */}
          <main className="app-content">{children}</main>
        </AccountProvider>
      </body>
    </html>
  );
}
