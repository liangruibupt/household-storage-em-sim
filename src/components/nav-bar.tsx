"use client";

// 常驻顶部导航 NavBar（需求 6.1、6.2、6.3）
//
// 设计要点（设计文档「各功能区组件设计 / 1. 应用框架与导航」）：
//   - 固定包含且仅包含四个入口：设备监控、账户信息、充放电数据、电力交易（需求 6.1）。
//   - 使用 Next.js `<Link>` 实现客户端导航，保证 2 秒内完成区域切换（需求 6.3）。
//   - 基于 `usePathname()` 判定当前区域并呈现选中态：
//       `aria-current="page"` 提供无障碍语义，配合视觉高亮（不仅依赖颜色）（需求 6.3）。
//   - 导航在 `layout.tsx` 中渲染，配合 CSS sticky 定位保持常驻可见（需求 6.2）。

import Link from "next/link";
import { usePathname } from "next/navigation";

// 单个导航入口的定义
interface NavItem {
  /** 目标路由路径 */
  href: string;
  /** 导航显示文本（中文 UI） */
  label: string;
}

/**
 * 四个固定导航入口（顺序固定，数量恒为 4）（需求 6.1）。
 * 顺序与需求一致：设备监控 → 账户信息 → 充放电数据 → 电力交易。
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/devices", label: "设备监控" },
  { href: "/account", label: "账户信息" },
  { href: "/energy", label: "充放电数据" },
  { href: "/trading", label: "电力交易" },
] as const;

/**
 * 判定某导航入口相对当前路径是否处于选中态。
 *
 * 规则：当前路径与入口 `href` 完全相等，或以 `href + "/"` 开头（命中子路由），
 * 即视为该入口被选中。
 *
 * 参数:
 *   pathname (string | null): 当前路径（来自 usePathname()）
 *   href (string): 导航入口目标路径
 *
 * 返回:
 *   boolean: 是否为当前选中入口
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) {
    return false;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 常驻顶部导航组件。
 *
 * 返回:
 *   JSX.Element: 含四个客户端导航入口的 <nav>，当前区域呈现选中态。
 */
export default function NavBar(): JSX.Element {
  // 读取当前路径，用于派生选中态（客户端 Hook）
  const pathname = usePathname();

  return (
    <nav className="nav-bar" aria-label="主导航">
      <span className="nav-bar__brand">家庭储能能源管理平台</span>
      <ul className="nav-bar__list">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="nav-bar__item">
              <Link
                href={item.href}
                className={
                  active ? "nav-bar__link nav-bar__link--active" : "nav-bar__link"
                }
                // 选中态的无障碍语义标记（需求 6.3）
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
