# Implementation Plan: 家庭储能能源管理平台（实施计划）

## Overview

### 概述

本实施计划将设计文档转化为一系列可由编码代理增量执行的编码任务。技术栈为 **Next.js 14+（App Router）+ TypeScript（严格模式）**，图表使用 **Recharts**，测试使用 **Vitest + fast-check + React Testing Library**。

任务遵循自底向上、逐层集成的顺序：先搭建脚手架与类型，再实现纯函数（校验器、领域算法），随后是抽象数据访问层接口、确定性可种子化的 `MockProvider`，再到 API 路由处理程序，最后是前端各功能区组件与端到端集成。每个任务都建立在前序任务之上，并最终接线集成，不留孤立代码。

设计文档包含 16 条正确性属性（Property 1–16），因此每条属性都对应一个独立的、基于 fast-check 的属性测试子任务（标记为可选 `*`），并紧邻其被测实现放置，以尽早发现错误。

## Tasks

- [x] 1. 搭建项目脚手架与测试基础设施
  - [x] 1.1 初始化 Next.js + TypeScript 项目结构
    - 初始化 Next.js 14+（App Router）项目，启用 TypeScript 严格模式（`tsconfig.json` 中 `strict: true`）
    - 按设计文档建立目录骨架：`src/app/`、`src/lib/data-access/`、`src/lib/domain/`、`src/lib/http/`、`src/components/`、`src/test/`
    - 安装并配置 Recharts 依赖
    - 创建 `src/app/layout.tsx` 与 `src/app/page.tsx` 占位，使项目可编译启动
    - _Requirements: 6.1_

  - [x] 1.2 配置测试框架（Vitest + fast-check + React Testing Library）
    - 安装并配置 Vitest 作为测试运行器，建立 `src/test/properties/` 与 `src/test/arbitraries/` 目录
    - 安装 fast-check 作为属性测试库（不自行实现属性测试框架），统一约定 `numRuns: 100` 与确定性 seed
    - 安装 React Testing Library 用于组件/交互测试
    - 添加 `test` 脚本（使用单次运行模式，非 watch 模式）
    - _Requirements: 5.2_

- [x] 2. 定义核心领域类型与契约
  - [x] 2.1 实现 `lib/data-access/types.ts` 领域类型与统一返回类型
    - 定义 `Result<T>` 判别联合、`DataError` 与 `DataErrorType`（`NOT_FOUND`/`VALIDATION`/`PROVIDER_ERROR`/`TIMEOUT`）
    - 定义设备类型：`ConnectionStatus`、`Device`、`DeviceDetail`
    - 定义账户类型：`AccountProfile`、`AccountProfileInput`
    - 定义充放电类型：`ChargeDischargeRecord`、`DailySummary`
    - 定义交易类型：`StrategyAction`、`PriceComparator`、`TriggerCondition`、`TradingStrategy`、`TradingStrategyInput`、`TradingStrategyPatch`、`StrategyActionRecord`、`MarketState`
    - _Requirements: 1.2, 2.1, 3.3, 4.4, 4.5, 5.5_

- [x] 3. 实现纯函数校验器
  - [x] 3.1 实现 `lib/data-access/validation.ts` 账户与策略校验器
    - 实现账户字段校验：姓名 1–50 字符、邮箱标准格式且 ≤254、电话 5–20 字符且仅含 `[0-9 + - 空格]`、地址 ≤200，返回结构化结果并指明出错 `field`
    - 实现策略字段校验：名称 1–100 字符、`action` ∈ 4 种枚举、`comparator` ∈ 5 种枚举、电价阈值 ∈ [0, 999999.99]，必填字段缺失时拒绝
    - 校验器为不抛异常的纯函数，便于属性测试
    - _Requirements: 2.3, 2.4, 2.5, 4.8, 4.9_

  - [x]* 3.2 编写账户校验属性测试
    - **Property 5: 非法账户字段被拒且原值不变**
    - **Validates: Requirements 2.3, 2.4, 2.5**
    - 覆盖边界：长度 0/1/50/51/254/255、非法字符、缺少 `@` 的邮箱

  - [x]* 3.3 编写策略创建校验属性测试
    - **Property 10: 策略创建校验拒绝非法输入**
    - **Validates: Requirements 4.8, 4.9**
    - 覆盖边界：名称 0/1/100/101、非枚举 action/comparator、阈值越界、缺字段

- [x] 4. 实现领域算法：连接状态判定
  - [x] 4.1 实现 `lib/domain/connection.ts` 在线/离线派生函数
    - 实现纯函数 `isOnline(lastReportedAt, now)`：当 `now - lastReportedAt <= 60000ms` 时为在线
    - 实现由 `lastReportedAt` 与 `now` 派生 `connectionStatus`（`online`/`offline`）
    - _Requirements: 1.2, 1.3_

  - [x] 4.2 编写连接状态取值封闭属性测试
    - **Property 2: 连接状态取值封闭**
    - **Validates: Requirements 1.2**

  - [x] 4.3 编写 60 秒窗口判定属性测试
    - **Property 3: 在线/离线 60 秒窗口判定**
    - **Validates: Requirements 1.3**
    - 覆盖边界：delta = 0 / 60000 / 60001 / 负值

- [x] 5. 实现领域算法：7 天零填充聚合
  - [x] 5.1 实现 `lib/domain/weekly.ts` 的 `buildWeeklyRecords`
    - 给定原始记录与"今天"，输出恰好 7 条、按日期升序、含当日在内向前回溯 7 个连续自然日、缺失日 `chargeKwh`/`dischargeKwh` 零填充的记录
    - _Requirements: 3.2, 3.3, 3.5_

  - [x] 5.2 编写 7 天数据集合不变量属性测试
    - **Property 7: 7 天数据集合不变量（含零填充）**
    - **Validates: Requirements 3.2, 3.3, 3.5**
    - 覆盖：空集合、部分缺失、全覆盖、跨月边界

- [x] 6. 实现领域算法：策略触发去抖
  - [x] 6.1 实现 `lib/domain/trigger.ts` 的 `evaluateTrigger`
    - 实现去抖语义：条件满足且此前未触发则记录一次并置 `triggered=true`；持续满足不重复记录；条件不再满足则重置 `triggered=false`
    - 支持 5 种 `comparator` 的电价比较
    - _Requirements: 4.10_

  - [x] 6.2 编写触发去抖属性测试
    - **Property 13: 触发去抖单次记录与重置**
    - **Validates: Requirements 4.10**
    - 覆盖：持续满足序列、跌出再进入、各 comparator

- [x] 7. 检查点 - 确保纯函数层测试全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 定义数据访问层抽象接口
  - [x] 8.1 实现 `lib/data-access/provider.ts` 的 `IDataProvider` 接口
    - 声明全部方法签名：`listDevices`、`getDevice`、`getAccountProfile`、`updateAccountProfile`、`getTodaySummary`、`getWeeklyRecords`、`listStrategies`、`createStrategy`、`updateStrategy`、`deleteStrategy`、`getMarketState`，均返回 `Promise<Result<T>>`
    - 接口不引用任何具体实现
    - _Requirements: 5.1, 5.4_

- [x] 9. 实现 Mock 数据基础设施
  - [x] 9.1 实现 `lib/data-access/mock/rng.ts` 可种子化伪随机数生成器
    - 实现纯函数 PRNG（如 mulberry32），相同 seed 产生相同序列，保证可复现
    - _Requirements: 5.2_

  - [x] 9.2 实现 `lib/data-access/mock/seed-data.ts` 确定性种子数据
    - 由固定 seed 生成单一 `AccountProfile`、`Device[]`（≤200 台，含覆盖在线/离线两侧的 `lastReportedAt`）、初始 `TradingStrategy[]`、充放电原始记录
    - 充放电数值在生成阶段钳制到 `[0, 999999999.99]`
    - 所有数据归属单一 User（注册数量上限 1）
    - _Requirements: 1.1, 3.7, 5.2, 6.4_

- [x] 10. 实现 MockProvider 与数据提供者工厂
  - [x] 10.1 实现 MockProvider 设备方法
    - 创建 `lib/data-access/mock/mock-provider.ts`，实现 `listDevices`（最多返回 200 台，调用 `connection.ts` 即时派生 `connectionStatus`）与 `getDevice`（不存在返回 `NOT_FOUND`，含精确到秒的最近更新时间）
    - _Requirements: 1.1, 1.2, 1.3, 1.8_

  - [x] 10.2 编写设备数量上限属性测试
    - **Property 1: 设备数量上限不变量**
    - **Validates: Requirements 1.1**
    - 覆盖：0 / 200 / >200 种子规模

  - [x] 10.3 实现 MockProvider 账户方法
    - 实现 `getAccountProfile` 与 `updateAccountProfile`：调用 `validation.ts`，校验通过则写入内存态并返回最新值，失败返回 `VALIDATION` 错误且不改动内存
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 10.4 编写账户更新往返一致属性测试
    - **Property 4: 账户资料更新往返一致**
    - **Validates: Requirements 2.2**

  - [x] 10.5 实现 MockProvider 充放电方法
    - 实现 `getTodaySummary`（当日各设备求和；`deviceId` 省略表示全部汇总）与 `getWeeklyRecords`（调用 `weekly.ts` 即时派生 7 天零填充集合）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x]* 10.6 编写当日总量求和与 2 位小数属性测试
    - **Property 6: 当日总量等于各设备求和且格式化为 2 位小数**
    - **Validates: Requirements 3.1**

  - [x] 10.7 编写充放电值域不变量属性测试
    - **Property 8: 充放电值域不变量**
    - **Validates: Requirements 3.7**
    - 覆盖边界：0 / 999999999.99

  - [x] 10.8 实现 MockProvider 交易方法与触发引擎
    - 实现 `listStrategies`、`createStrategy`（经 `validation.ts`）、`updateStrategy`、`deleteStrategy`、`getMarketState`（当前电价 + 触发历史倒序、最多 50 条）
    - 内置评估循环：对每条启用策略调用 `evaluateTrigger`，按去抖语义记录动作并截断/倒序历史
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 4.10, 4.11_

  - [x] 10.9 编写策略创建往返一致属性测试
    - **Property 9: 策略创建往返一致**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [x] 10.10 编写策略启用状态更新往返一致属性测试
    - **Property 11: 策略启用状态更新往返一致**
    - **Validates: Requirements 4.6**

  - [x] 10.11 编写策略删除后不可见属性测试
    - **Property 12: 策略删除后不可见**
    - **Validates: Requirements 4.7**

  - [x] 10.12 编写触发历史倒序且截断属性测试
    - **Property 14: 触发历史倒序且截断**
    - **Validates: Requirements 4.11**
    - 覆盖：>50 条触发、时间乱序

  - [x] 10.13 实现 `lib/data-access/factory.ts` 的 `getDataProvider()` 工厂/单例
    - 返回 `MockProvider` 单例实例，作为 API 层获取数据提供者的唯一入口，便于未来零改动替换为真实实现
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 10.14 编写成功返回数据契约属性测试
    - **Property 15: 成功返回符合数据契约**
    - **Validates: Requirements 5.2, 5.5**
    - 对全部 `IDataProvider` 方法成功调用校验返回结构

  - [x] 10.15 编写失败返回结构化错误属性测试
    - **Property 16: 失败返回结构化错误且无部分数据**
    - **Validates: Requirements 5.6**
    - 覆盖数据不存在、校验失败、内部错误分支

- [x] 11. 检查点 - 确保数据访问层测试全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 实现 API 路由处理程序
  - [x] 12.1 实现设备 API 路由
    - 创建 `app/api/devices/route.ts`（GET 列表）与 `app/api/devices/[id]/route.ts`（GET 详情）
    - 经 `getDataProvider()` 调用接口，将 `Result<T>` 映射为 HTTP 响应（200 / 404 / 500），不泄漏栈信息
    - _Requirements: 1.1, 1.8, 5.1, 5.4_

  - [x] 12.2 实现账户 API 路由
    - 创建 `app/api/account/route.ts`（GET 获取 / PUT 更新）
    - 将 `VALIDATION` 映射为 400 并携带 `field`，更新成功返回最新资料
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 12.3 实现充放电 API 路由
    - 创建 `app/api/energy/summary/route.ts`（GET 当日总量）与 `app/api/energy/weekly/route.ts`（GET 7 天数据），支持可选 `deviceId` 查询参数
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 12.4 实现电力交易 API 路由
    - 创建 `app/api/trading/strategies/route.ts`（GET 列表 / POST 创建）、`app/api/trading/strategies/[id]/route.ts`（PUT / DELETE）、`app/api/trading/market/route.ts`（GET 电价 + 历史）
    - 创建用 201，删除/启停返回更新结果，校验失败 400
    - _Requirements: 4.1, 4.3, 4.6, 4.7, 4.11_

  - [x] 12.5 编写 API 路由集成测试
    - 测试各路由对成功与各类错误（400/404/500/504）的 `Result<T>` → HTTP 映射，断言不返回部分数据或栈信息
    - _Requirements: 5.4, 5.6_

- [x] 13. 实现前端 HTTP 客户端封装
  - [x] 13.1 实现 `lib/http/client.ts` 的 fetch 封装
    - 提供加载态、硬超时（通用 10s）、失败保留"上一次成功数据"、手动重试入口的统一封装
    - 解析 `{ data }` / `{ error }` 响应结构，区分空数据（正常）与错误
    - _Requirements: 1.7, 3.6, 6.5, 6.6_

- [x] 14. 实现应用框架与常驻导航
  - [x] 14.1 实现 `app/layout.tsx`、`NavBar` 与共享加载/错误组件
    - 在 `app/layout.tsx` 渲染常驻导航并包裹页面内容；导航使用 sticky/fixed 定位保持始终可见不被遮挡
    - `NavBar` 含且仅含四个入口（设备监控、账户信息、充放电数据、电力交易），基于 `usePathname()` 呈现选中态（`aria-current="page"` + 高亮），使用 `<Link>` 实现 2 秒内客户端切换
    - 实现共享 `LoadingState` / `ErrorState` 组件（错误态含重试按钮且保留已有内容）
    - 在 `app/page.tsx` 默认重定向到设备监控
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x] 14.2 编写导航单元测试
    - 测试四个导航入口存在且可点击、选中态标记、导航常驻可见
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 15. 实现设备监控功能区
  - [x] 15.1 实现设备监控页面与组件
    - 创建 `app/devices/page.tsx`，调用 `GET /api/devices`，维护 `lastSuccessfulDevices` 以便失败时保留显示
    - 实现 `DeviceList`（空列表显示"暂无设备"空状态）、`StatusBadge`（在线/离线呈现不同颜色**且**不同文本标签/图标，不依赖颜色可区分）、`DeviceDetail`（名称、唯一标识、状态、精确到秒的最近更新时间）、`RefreshButton`（重新拉取并 3 秒内更新）
    - 失败时显示错误提示 + 重试并保留上次列表
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 15.2 编写设备监控组件测试
    - 测试状态徽章双重标识、刷新交互、空状态、失败保留+重试、设备详情字段
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 16. 实现账户信息功能区
  - [x] 16.1 实现账户页面与表单
    - 创建 `app/account/page.tsx` 与 `AccountForm`：`GET /api/account` 预填、空字段显示为空；提交 `PUT /api/account`
    - 成功显示成功提示并展示最新资料；校验失败显示对应字段错误并保留用户输入
    - _Requirements: 2.1, 2.6, 2.7_

  - [x] 16.2 编写账户表单组件测试
    - 测试空字段渲染、成功提示、错误提示与输入保留
    - _Requirements: 2.1, 2.6, 2.7_

- [x] 17. 实现充放电数据可视化功能区
  - [x] 17.1 实现充放电页面与图表组件
    - 创建 `app/energy/page.tsx`，并行请求 `summary` 与 `weekly`
    - 实现 `TodaySummaryCards`（当日总充/放电量，kWh，保留 2 位小数）、`WeeklyChart`（Recharts，按日期升序展示 7 天，零填充日显示为 0）、`DeviceScopeToggle`（设备数 ≥ 2 时显示单设备/全部汇总切换，切换后 3 秒内更新）
    - 10 秒超时或失败时显示错误 + 重试且不清空已有内容
    - _Requirements: 3.1, 3.2, 3.4, 3.6_

  - [x] 17.2 编写充放电组件测试
    - 测试当日总量 2 位小数展示、7 天升序与零填充渲染、设备范围切换、失败保留+重试
    - _Requirements: 3.1, 3.4, 3.6_

- [x] 18. 实现智能电力交易功能区
  - [x] 18.1 实现交易页面与策略组件
    - 创建 `app/trading/page.tsx`，请求 `strategies` 与 `market`
    - 实现 `StrategyList`（展示策略及启用状态，无策略显示"暂无策略"空状态）、`StrategyForm`（名称、action、触发条件 comparator+priceThreshold、enabled，提交经服务端校验）、`StrategyToggle`/`DeleteStrategy`（启停/删除）、`MarketPanel`（当前电价）、`ActionHistory`（按时间倒序，最多 50 条）
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 4.11_

  - [x] 18.2 编写交易组件测试
    - 测试策略列表与启用状态、空状态、创建/启停/删除交互、电价与历史倒序展示
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.11_

- [x] 19. 实现架构约束与可替换性校验
  - [x] 19.1 编写架构约束与单用户校验测试
    - 以 lint 规则/静态检查断言 `components/` 与 `app/`（除 `app/api`）不 import `lib/data-access/mock`，仅经 `IDataProvider`
    - 提供实现同一接口的第二 stub 注入 `getDataProvider()`，验证 API 层与 UI 源码零改动即可编译通过
    - 断言单一 User 约束（注册上限 1）
    - _Requirements: 5.1, 5.3, 5.4, 6.4_

- [x] 20. 最终检查点 - 确保全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. 多账户能力改造（Multi-Account）
  - [x] 21.1 扩展领域类型与契约以支持多账户
    - 在 `lib/data-access/types.ts` 新增 `Account`（`id` + `profile`）与 `AccountProfileInput`
    - 为 `Device`、`ChargeDischargeRecord`、`TradingStrategy` 增加 `accountId` 归属字段
    - 扩展 `DataErrorType`，新增 `ACCOUNT_LIMIT`（账户数达上限 5）与 `LAST_ACCOUNT`（仅剩 1 个账户拒绝删除）
    - 调整 `TradingStrategyInput`/`TradingStrategyPatch` 等派生类型以排除 `accountId`（由作用域参数提供）
    - _Requirements: 2.4, 2.5, 2.11, 2.12, 6.4_

  - [x] 21.2 扩展 `IDataProvider` 接口为账户作用域
    - 在 `lib/data-access/provider.ts` 新增账户方法：`listAccounts`、`getAccount`、`createAccount`、`updateAccountProfile(accountId, input)`、`deleteAccount`
    - 为既有数据方法增加 `accountId` 作用域参数：`listDevices(accountId)`、`getDevice(accountId, id)`、`getTodaySummary(accountId, deviceId?)`、`getWeeklyRecords(accountId, deviceId?)`、`listStrategies(accountId)`、`createStrategy(accountId, input)`、`updateStrategy(accountId, id, patch)`、`deleteStrategy(accountId, id)`、`getMarketState(accountId)`
    - 移除旧的单账户 `getAccountProfile`/无参 `updateAccountProfile`，接口不引用任何具体实现
    - _Requirements: 2.4, 2.6, 2.11, 5.1, 6.5_

  - [x] 21.3 改造 `MockProvider` 与 `seed-data` 为多账户
    - 更新 `lib/data-access/mock/seed-data.ts`：默认种子化多个账户（默认 2 个），每账户拥有独立 `AccountProfile` 及名下归属的 `Device[]`/`ChargeDischargeRecord[]`/`TradingStrategy[]`，每条数据带正确 `accountId`，保持确定性可复现
    - 更新 `lib/data-access/mock/mock-provider.ts`：实现账户 CRUD（`createAccount` 达 5 个返回 `ACCOUNT_LIMIT` 不写入；`deleteAccount` 仅剩 1 个返回 `LAST_ACCOUNT` 不删除，否则级联移除该账户名下 Device/记录/策略/触发历史并返回剩余账户标识）
    - 既有数据方法按 `accountId` 过滤与归属读写，`accountId` 不存在返回 `NOT_FOUND`；删除 Current_Account 时由返回的剩余账户支持前端自动切换
    - _Requirements: 2.4, 2.5, 2.11, 2.12, 2.13, 6.4, 6.5_

  - [x]* 21.4 编写账户数量上限属性测试
    - **Property 17: 账户数量上限 5 创建被拒**
    - **Validates: Requirements 2.5, 6.4**
    - 覆盖：恰好 5 个账户时任意创建输入被拒、集合长度仍为 5

  - [x]* 21.5 编写至少保留 1 个账户属性测试
    - **Property 18: 至少保留 1 个账户**
    - **Validates: Requirements 2.12**
    - 覆盖：仅含 1 个账户时删除被拒、账户仍存在

  - [x]* 21.6 编写账户创建往返一致属性测试
    - **Property 19: 账户创建往返一致**
    - **Validates: Requirements 2.4**
    - 覆盖：账户数 0..4 时创建后集合 +1、`id` 唯一、`getAccount` 资料与输入等价

  - [x]* 21.7 编写账户删除级联移除属性测试
    - **Property 20: 账户删除级联移除归属数据**
    - **Validates: Requirements 2.11**
    - 覆盖：删除后该账户名下数据不可访问、其他账户及其数据不变

  - [x]* 21.8 编写账户数据隔离属性测试
    - **Property 21: 账户数据隔离**
    - **Validates: Requirements 6.4, 6.5**
    - 覆盖：多账户种子下各作用域读取返回数据的 `accountId` 恒等于查询账户、跨账户不泄漏

  - [x]* 21.9 更新设备数量上限属性测试为账户作用域
    - **Property 1: 设备数量上限不变量（账户作用域）**
    - **Validates: Requirements 1.1**
    - 改为对任意账户调用 `listDevices(accountId)`，覆盖 0 / 200 / >200 种子规模、多账户

  - [x]* 21.10 更新账户资料更新往返属性测试（不影响其他账户）
    - **Property 4: 账户资料更新往返一致且不影响其他账户**
    - **Validates: Requirements 2.6**
    - 改为 `updateAccountProfile(accountId, p)` 后目标账户往返一致，且任意其他账户资料不变

  - [x]* 21.11 更新非法账户字段被拒属性测试（创建与更新两路径）
    - **Property 5: 非法账户字段被拒且原值不变**
    - **Validates: Requirements 2.7, 2.8, 2.9**
    - 覆盖 `createAccount` 与 `updateAccountProfile(accountId, ...)` 两条路径：非法邮箱/姓名/电话/地址返回 `VALIDATION` 并指明 `field`，不新增账户、相关账户原值不变，且不影响其他账户

  - [x]* 21.12 更新当日总量属性测试为账户作用域
    - **Property 6: 当日总量等于各设备求和且格式化为 2 位小数（账户作用域）**
    - **Validates: Requirements 3.1**
    - 改为对任意账户 `getTodaySummary(accountId)` 等于该账户名下各设备当日求和、展示保留 2 位小数

  - [x]* 21.13 更新策略创建往返属性测试（归属当前账户）
    - **Property 9: 策略创建往返一致（归属当前账户）**
    - **Validates: Requirements 4.3, 4.4, 4.5**
    - 改为 `createStrategy(accountId, input)` 后 `listStrategies(accountId)` 含该策略且 `accountId` 等于入参账户

  - [x]* 21.14 更新触发历史倒序截断属性测试为账户作用域
    - **Property 14: 触发历史倒序且截断（账户作用域）**
    - **Validates: Requirements 4.11**
    - 改为 `getMarketState(accountId)` 的 `history` 按时间倒序、长度 ≤ 50

  - [x]* 21.15 更新成功返回数据契约属性测试（含账户方法）
    - **Property 15: 成功返回符合数据契约**
    - **Validates: Requirements 5.2, 5.5**
    - 扩展覆盖账户方法 `listAccounts`/`getAccount`/`createAccount`/`updateAccountProfile`/`deleteAccount` 与账户作用域方法的成功返回结构

  - [x]* 21.16 更新失败返回结构化错误属性测试（含新错误类型）
    - **Property 16: 失败返回结构化错误且无部分数据**
    - **Validates: Requirements 5.6**
    - 扩展覆盖 `error.type` ∈ 含 `ACCOUNT_LIMIT`、`LAST_ACCOUNT` 的枚举集合，且失败时不携带业务数据

  - [x] 21.17 实现账户 API 路由
    - 创建 `app/api/accounts/route.ts`（GET 列表 / POST 创建）与 `app/api/accounts/[id]/route.ts`（GET 详情 / PUT 更新资料 / DELETE 删除）
    - 经 `getDataProvider()` 调用账户方法并映射 `Result<T>` → HTTP：创建用 201，`VALIDATION`→400（含 `field`），`ACCOUNT_LIMIT`→409，`LAST_ACCOUNT`→409，`NOT_FOUND`→404；删除成功返回剩余账户标识
    - 移除旧的单账户 `app/api/account/route.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 6.5_

  - [x] 21.18 改造既有 API 路由为账户作用域
    - 为 `app/api/devices/route.ts`、`app/api/devices/[id]/route.ts`、`app/api/energy/summary/route.ts`、`app/api/energy/weekly/route.ts`、`app/api/trading/strategies/route.ts`、`app/api/trading/strategies/[id]/route.ts`、`app/api/trading/market/route.ts` 解析 `?accountId` 查询参数并透传给对应账户作用域方法
    - 缺失或非法 `accountId` 时映射为 `NOT_FOUND`/`VALIDATION` 对应的 HTTP 响应
    - _Requirements: 1.1, 1.8, 3.1, 3.2, 4.1, 4.11, 6.5_

  - [x] 21.19 前端 HTTP 客户端自动附加 accountId
    - 更新 `lib/http/client.ts`：对设备/能源/交易类请求自动附加当前 `accountId` 查询参数（由调用方传入或从上下文取值）
    - 保持既有加载态、硬超时、失败保留与重试语义不变
    - _Requirements: 6.5, 6.6_

  - [x] 21.20 实现 `AccountContext` 与导航区 `AccountSwitcher`
    - 在 `components/account/` 实现 `AccountContext`（持有 `currentAccountId` 与账户列表，提供 `setCurrentAccount(id)`，切换后触发各功能区在 3 秒内刷新）
    - 在 `components/nav/` 实现 `AccountSwitcher`（常驻导航区，展示账户列表 ≤5 并标记 Current_Account），在 `app/layout.tsx` 用 `AccountProvider` 包裹页面内容
    - _Requirements: 2.1, 2.3, 6.4, 6.6_

  - [x] 21.21 改造账户页为列表/创建/选择编辑/删除
    - 改造 `app/account/page.tsx` 与 `components/account/`：`AccountListPanel`（≤5、选中态、空状态"暂无账户"+创建入口）、`CreateAccountForm`（达 5 个时禁用/提示上限）、`AccountSelect`（点击设为 Current_Account 并预填编辑表单、空字段显示为空）、`EditAccountForm`（成功/字段错误+保留输入）、`DeleteAccountButton`（删除确认、至少保留 1 个提示、删除 Current_Account 自动切换至剩余账户并刷新各区）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14_

  - [x] 21.22 改造设备/能源/交易页为账户作用域
    - 更新 `app/devices/page.tsx`、`app/energy/page.tsx`、`app/trading/page.tsx`：从 `AccountContext` 读取 `currentAccountId` 并随请求传递，仅展示与操作 Current_Account 名下数据
    - 切换 Current_Account 后各区在 3 秒内重新拉取并更新展示
    - _Requirements: 1.1, 3.1, 4.1, 6.5, 6.6_

  - [x]* 21.23 编写账户管理组件测试
    - 测试账户列表与选中态、创建（含上限提示）、选择编辑与空字段渲染、更新成功/错误保留输入、删除确认与至少保留 1 个、删除 Current_Account 后自动切换
    - _Requirements: 2.1, 2.2, 2.3, 2.10, 2.12, 2.13, 2.14_

  - [x]* 21.24 编写账户切换器与数据刷新/隔离组件测试
    - 测试 `AccountSwitcher` 展示与选中态、切换后设备/能源/交易区在 3 秒内刷新、不同账户视图数据隔离
    - _Requirements: 6.4, 6.5, 6.6_

  - [x] 21.25 更新架构约束与多账户校验测试
    - 更新 `components/`/`app/`（除 `app/api`）不 import `lib/data-access/mock` 的静态检查
    - 第二实现 stub 注入 `getDataProvider()` 验证零改动可编译（含新增账户方法签名）
    - 将注册上限断言由 1 改为 **5**
    - _Requirements: 5.1, 5.3, 5.4, 6.4_

  - [x] 21.26 多账户收尾检查点 - 类型检查 + 全量测试 + 构建通过
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（单元测试、属性测试、集成测试），可在追求 MVP 时跳过；顶层任务不标记可选。
- 每条正确性属性（Property 1–21）均为独立的属性测试子任务，使用 fast-check 且 `numRuns >= 100`，并紧邻其被测实现放置以尽早发现错误。
- 任务 1–20 为已完成的单用户版本；任务组 21 为多账户能力的增量改造（新增 P17–P21，并将受影响的既有属性 P1/P4/P5/P6/P9/P14/P15/P16 调整为账户作用域）。
- 每个任务引用其满足的具体需求条款编号，保证可追溯性。
- 检查点用于增量验证，确保每一层在进入下一层前稳定。
- 渲染时延、颜色/视觉呈现、导航结构、加载指示等 UI/性能类需求通过组件测试与静态检查覆盖，不使用属性测试。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1", "4.1", "5.1", "6.1", "8.1", "9.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3", "5.2", "6.2", "9.2"] },
    { "id": 4, "tasks": ["10.1"] },
    { "id": 5, "tasks": ["10.3"] },
    { "id": 6, "tasks": ["10.5"] },
    { "id": 7, "tasks": ["10.8"] },
    { "id": 8, "tasks": ["10.13", "10.2", "10.4", "10.6", "10.7", "10.9", "10.10", "10.11", "10.12", "10.14", "10.15"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4", "13.1"] },
    { "id": 10, "tasks": ["12.5", "14.1", "15.1", "16.1", "17.1", "18.1"] },
    { "id": 11, "tasks": ["14.2", "15.2", "16.2", "17.2", "18.2", "19.1"] },
    { "id": 12, "tasks": ["21.1"] },
    { "id": 13, "tasks": ["21.2"] },
    { "id": 14, "tasks": ["21.3"] },
    { "id": 15, "tasks": ["21.4", "21.5", "21.6", "21.7", "21.8", "21.9", "21.10", "21.11", "21.12", "21.13", "21.14", "21.15", "21.16", "21.17", "21.18", "21.19"] },
    { "id": 16, "tasks": ["21.20"] },
    { "id": 17, "tasks": ["21.21", "21.22", "21.25"] },
    { "id": 18, "tasks": ["21.23", "21.24"] }
  ]
}
```
