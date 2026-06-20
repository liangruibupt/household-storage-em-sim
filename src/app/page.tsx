import { redirect } from "next/navigation";

// 首页：默认重定向到「设备监控」区域（需求 6.1）。
// 使用 Next.js 服务端 `redirect`，访问根路径 "/" 时立即跳转到 "/devices"。
export default function HomePage(): never {
  redirect("/devices");
}
