# 家庭储能能源管理平台（Household Energy Storage Management Platform）

基于 **Next.js 14+（App Router）+ TypeScript（严格模式）** 的全栈 Web 应用，面向单一用户管理其名下的多台家庭储能设备。

## 核心功能

- **设备连接状态监控**：查看名下所有储能设备的在线/离线状态。
- **账户信息管理**：查看并维护账户资料（姓名、邮箱、电话、地址）。
- **充放电数据可视化**：以图表展示当日及过去 7 天的充电与放电统计。
- **智能电力交易**：配置基于电价的自动化充放电与买卖电策略。

## 架构原则

平台采用严格的分层架构，核心是**数据来源可替换**：所有数据访问统一经由抽象的 `IDataProvider` 接口，当前由 `MockProvider` 实现支撑（使用 Mock 数据运行）。未来接入真实设备 API 时，仅需替换 `getDataProvider()` 的具体实现，`API_Layer` 与 `Web_UI` 源代码零改动。

```
浏览器 (Web_UI) → API 层 (Route Handlers) → DataAccessLayer (IDataProvider) → MockProvider
```

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Next.js 14+（App Router） |
| 语言 | TypeScript（`strict: true`） |
| 图表库 | Recharts |
| 测试 | Vitest + fast-check + React Testing Library |

## 目录结构

```
src/
├── app/                  # 页面、布局与 API 路由 (Route Handlers)
├── lib/
│   ├── data-access/      # 抽象数据访问层、类型、校验器、MockProvider
│   ├── domain/           # 纯函数领域算法（连接判定、7 天聚合、触发去抖）
│   └── http/             # 前端 fetch 封装
├── components/           # UI 组件（导航、设备、账户、充放电、交易）
└── test/                 # 单元测试 + 属性测试
```

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器（http://localhost:3000）
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm run start

# 代码检查
npm run lint
```

## 说明

- 本平台为单一用户场景，不涉及多租户隔离。
- 当前阶段使用 Mock（模拟）数据运行，数据访问层以抽象、可替换方式设计。
