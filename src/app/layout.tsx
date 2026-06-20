import type { Metadata } from "next";
import type { ReactNode } from "react";
import NavBar from "@/components/nav-bar";
import "./globals.css";

// 应用级元数据：标题与描述
export const metadata: Metadata = {
  title: "家庭储能能源管理平台",
  description: "管理家庭储能设备、账户信息、充放电数据与智能电力交易策略",
};

// 全局布局：渲染常驻导航 NavBar 并包裹所有页面内容（需求 6.1、6.2）。
// NavBar 使用 CSS sticky 定位（见 globals.css），滚动时保持置顶可见、不被遮挡。
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        {/* 常驻导航：始终位于页面顶部 */}
        <NavBar />
        {/* 页面主内容区域 */}
        <main className="app-content">{children}</main>
      </body>
    </html>
  );
}
