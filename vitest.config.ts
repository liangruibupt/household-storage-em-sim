import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 计算项目根目录，用于解析路径别名
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 启用 React 插件以支持 JSX/TSX 组件测试
  plugins: [react()],
  resolve: {
    alias: {
      // 与 tsconfig.json 中的 "@/*": ["./src/*"] 保持一致
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    // 使用 jsdom 环境以支持 React 组件 / DOM 交互测试
    environment: "jsdom",
    // 暴露全局 API（describe/it/expect 等），便于编写测试
    globals: true,
    // 全局测试初始化：注册 @testing-library/jest-dom 匹配器
    setupFiles: ["./src/test/setup.ts"],
    // 仅收集 src 下的测试文件
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
