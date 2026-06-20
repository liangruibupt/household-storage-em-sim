# Requirements Document

## Introduction

家庭储能能源管理平台（Household Energy Storage Management Platform）是一个基于 Next.js（TypeScript）的全栈 Web 应用，面向单一用户管理其名下的多台家庭储能设备。平台提供四项核心能力：设备连接状态监控、账户信息管理、充放电数据可视化，以及可配置自动化策略的智能电力交易。

当前阶段平台使用 Mock（模拟）数据运行，但其数据访问层必须以抽象、可替换的方式设计，以便未来无缝接入真实设备 API，而无需改动上层业务逻辑与界面。本平台为单一用户场景，不涉及多租户隔离。

本文档定义平台的功能性与非功能性需求，验收标准采用 EARS 模式编写，作为后续设计与实现的依据。

## Glossary

- **Platform（平台）**: 家庭储能能源管理平台的整体系统，包含前端界面、后端 API 路由与数据访问层。
- **Web_UI（前端界面）**: 基于 Next.js 渲染、供用户交互的浏览器界面。
- **API_Layer（API 层）**: Next.js 服务端路由处理程序，负责接收前端请求并返回数据。
- **Data_Access_Layer（数据访问层）**: 抽象的数据提供接口及其具体实现，当前由 Mock 实现支撑，未来可替换为真实设备 API 实现。
- **Mock_Provider（模拟数据提供者）**: Data_Access_Layer 的当前具体实现，返回预置或动态生成的模拟数据。
- **Device（设备）**: 一台家庭储能设备，具有唯一标识、名称、连接状态及充放电相关数据。
- **Connection_Status（连接状态）**: 设备的在线情况，取值为 `online`（在线）或 `offline`（离线）。
- **User（用户）**: 平台的单一使用者，拥有账户信息并管理名下所有 Device。
- **Account_Profile（账户信息）**: User 的账户资料，包含姓名、邮箱、电话、地址等字段。
- **Charge_Discharge_Record（充放电记录）**: 某 Device 在某时间区间内的充电量与放电量数据，单位为千瓦时（kWh）。
- **Trading_Strategy（电力交易策略）**: 一组可配置的自动化规则，依据电价等条件触发充电、放电或买卖电动作。
- **Electricity_Price（电价）**: 单位时间的市场电价，单位为货币/千瓦时。
- **Strategy_Action（策略动作）**: 由 Trading_Strategy 触发的具体行为，取值为 `charge`（充电）、`discharge`（放电）、`buy`（买电）或 `sell`（卖电）。

## Requirements

### 需求 1：设备连接状态监控

**用户故事（User Story）:** 作为家庭储能平台用户，我希望查看名下所有储能设备的连接与在线状态，以便及时了解每台设备是否正常工作。

#### 验收标准（Acceptance Criteria）

1. WHEN 用户打开设备监控页面，THE Web_UI SHALL 在 3 秒内显示该用户名下所有 Device 的列表，每项包含设备名称、唯一标识与 Connection_Status；列表最多展示 200 台 Device。
2. THE Platform SHALL 将每台 Device 的 Connection_Status 表示为 `online` 或 `offline` 两种取值之一。
3. WHILE 某台 Device 在最近 60 秒内已上报状态，THE Platform SHALL 将该 Device 的 Connection_Status 置为 `online`；IF 某台 Device 在最近 60 秒内未上报任何状态，THEN THE Platform SHALL 将该 Device 的 Connection_Status 置为 `offline`。
4. WHEN 设备列表渲染完成，THE Web_UI SHALL 为 `online` 状态与 `offline` 状态分别呈现颜色不同且文本标签不同的视觉标识，使两种状态在不依赖颜色的情况下也可区分。
5. WHEN 用户在设备监控页面触发刷新操作，THE Web_UI SHALL 从 API_Layer 重新获取所有 Device 的最新 Connection_Status，并在 3 秒内更新显示。
6. IF Data_Access_Layer 返回的设备列表为空，THEN THE Web_UI SHALL 显示"暂无设备"的空状态提示，且不显示错误提示。
7. IF API_Layer 获取设备数据失败，THEN THE Web_UI SHALL 显示指示获取失败的错误提示、保留上一次成功获取的设备列表显示，并提供可由用户手动触发的重试操作。
8. WHEN 用户选择某一台 Device，THE Web_UI SHALL 显示该 Device 的详细信息，包含名称、唯一标识、Connection_Status 与最近一次状态更新时间（精确到秒）。

### 需求 2：账户信息管理

**用户故事（User Story）:** 作为平台用户，我希望查看并维护我的账户信息，以便保持个人资料准确。

#### 验收标准（Acceptance Criteria）

1. WHEN 用户打开账户信息页面，THE Web_UI SHALL 显示 Account_Profile 的姓名、邮箱、电话与地址字段；IF 某字段无值，THEN THE Web_UI SHALL 将该字段显示为空。
2. WHEN 用户提交对 Account_Profile 的修改且全部字段通过校验，THE API_Layer SHALL 在 3 秒内将更新后的字段持久化至 Data_Access_Layer 并返回更新后的 Account_Profile。
3. IF 用户提交的邮箱字段不符合标准邮箱格式或长度超过 254 字符，THEN THE Platform SHALL 拒绝该次更新、保留 Data_Access_Layer 中原有 Account_Profile 不变，并返回指明邮箱格式错误的提示信息。
4. IF 用户提交的姓名字段为空或长度超出 1 至 50 字符范围，THEN THE Platform SHALL 拒绝该次更新、保留 Data_Access_Layer 中原有 Account_Profile 不变，并返回指明姓名不合法的提示信息。
5. IF 用户提交的电话字段长度超出 5 至 20 字符范围或包含数字、加号、连字符、空格之外的字符，或地址字段长度超过 200 字符，THEN THE Platform SHALL 拒绝该次更新、保留 Data_Access_Layer 中原有 Account_Profile 不变，并返回指明对应字段不合法的提示信息。
6. WHEN Account_Profile 更新成功，THE Web_UI SHALL 显示更新成功提示并展示最新的 Account_Profile。
7. IF API_Layer 在更新 Account_Profile 时发生错误，THEN THE Web_UI SHALL 显示错误提示并保留用户已输入的内容。

### 需求 3：充放电数据可视化

**用户故事（User Story）:** 作为平台用户，我希望以图表方式查看当日及过去 7 天的充电与放电统计数据，以便了解储能设备的使用情况。

#### 验收标准（Acceptance Criteria）

1. WHEN 用户打开充放电数据页面，THE Web_UI SHALL 在 3 秒内展示当日（从当日 00:00:00 至当前时刻）的总充电量与总放电量，数值单位为千瓦时（kWh），保留 2 位小数。
2. WHEN 用户打开充放电数据页面，THE Web_UI SHALL 以图表形式按日期升序展示过去 7 个自然日（含当日在内、向前回溯共 7 天）每一天的充电量与放电量。
3. THE Platform SHALL 以包含日期、充电量与放电量的 Charge_Discharge_Record 集合提供统计数据，且该集合恰好包含 7 条记录，覆盖含当日在内向前回溯的 7 个连续自然日，每个自然日对应且仅对应 1 条记录。
4. WHERE 用户名下存在 2 台及以上 Device，THE Web_UI SHALL 提供按单台 Device 查看与按全部 Device 汇总查看充放电数据的切换能力，且切换后在 3 秒内更新展示数据。
5. IF 某一自然日不存在 Charge_Discharge_Record，THEN THE Platform SHALL 将该自然日的充电量与放电量均记为 0，并将其作为 1 条记录纳入 7 天数据集合。
6. IF API_Layer 在 10 秒内未成功返回充放电数据或返回失败响应，THEN THE Web_UI SHALL 显示指示数据获取失败的错误提示、保留页面已有展示内容不被清空，并提供可由用户手动触发的重试操作。
7. THE Data_Access_Layer SHALL 将所有充放电数据以非负数值返回，取值范围为 0.00 至 999,999,999.99 千瓦时（kWh）。

### 需求 4：智能电力交易与自动化策略

**用户故事（User Story）:** 作为平台用户，我希望配置基于电价的自动化电力交易策略，以便系统按规则自动充放电或买卖电，从而优化用电成本。

#### 验收标准（Acceptance Criteria）

1. WHEN 用户打开电力交易页面，THE Web_UI SHALL 在 3 秒内显示已配置的 Trading_Strategy 列表及每条策略的启用状态。
2. IF 不存在任何已配置的 Trading_Strategy，THEN THE Web_UI SHALL 显示"暂无策略"的空状态提示，且不显示错误提示。
3. WHEN 用户创建一条 Trading_Strategy 且各字段通过校验，THE API_Layer SHALL 持久化该策略的名称、触发条件、Strategy_Action 与启用状态，并返回创建后的策略。
4. THE Platform SHALL 支持将 Trading_Strategy 的 Strategy_Action 配置为 `charge`、`discharge`、`buy` 或 `sell` 四种取值之一。
5. WHEN 用户为某条 Trading_Strategy 设置基于 Electricity_Price 的触发条件，THE Platform SHALL 持久化该条件中的电价阈值与比较关系，比较关系取值为 `greater_than`、`greater_or_equal`、`less_than`、`less_or_equal` 或 `equal` 五者之一。
6. WHEN 用户启用或停用某条 Trading_Strategy，THE API_Layer SHALL 更新该策略的启用状态并返回更新后的策略。
7. WHEN 用户删除某条 Trading_Strategy，THE API_Layer SHALL 从 Data_Access_Layer 移除该策略并从列表中将其去除。
8. IF 用户提交的 Trading_Strategy 缺少触发条件、Strategy_Action 或策略名称，或策略名称长度超出 1 至 100 字符范围，THEN THE Platform SHALL 拒绝该次创建、不持久化任何数据，并返回指明缺失或不合法字段的提示信息。
9. IF 用户提交的电价阈值超出 0 至 999999.99 范围，THEN THE Platform SHALL 拒绝该次配置、不持久化任何数据，并返回指明电价阈值必须在 0 至 999999.99 之间的提示信息。
10. WHILE 某条 Trading_Strategy 处于启用状态且当前 Electricity_Price 持续满足其触发条件，THE Platform SHALL 最多记录一次对应的 Strategy_Action，并在触发条件不再满足后重置触发状态以允许下一次记录。
11. THE Web_UI SHALL 展示当前的 Electricity_Price，并按时间倒序展示最近触发的 Strategy_Action 历史记录，最多展示 50 条。

### 需求 5：Mock 数据与可替换数据访问层

**用户故事（User Story）:** 作为开发者，我希望平台的数据访问层是抽象且可替换的，以便当前用 Mock 数据运行，未来无缝接入真实设备 API。

#### 验收标准（Acceptance Criteria）

1. THE Platform SHALL 通过统一的 Data_Access_Layer 接口访问 Device、Account_Profile、Charge_Discharge_Record 与 Trading_Strategy 数据，且 Web_UI 中不出现对任何具体数据来源（包括 Mock_Provider 或真实设备 API）的直接引用。
2. WHEN API_Layer 调用 Data_Access_Layer 接口方法，THE Data_Access_Layer SHALL 由 Mock_Provider 实现，并返回字段集合与字段类型均符合该方法在各需求中所定义数据结构的模拟数据。
3. WHERE 接入真实设备 API，THE Platform SHALL 支持以真实 API 实现替换 Mock_Provider，且替换后 API_Layer 调用方与 Web_UI 的源代码无需任何修改即可正常运行。
4. THE API_Layer SHALL 仅调用 Data_Access_Layer 接口所定义的方法签名，且仅依据其返回数据结构进行处理，不引用 Mock_Provider 的内部实现细节。
5. WHEN API_Layer 调用 Data_Access_Layer 的任一方法且操作成功，THE Data_Access_Layer SHALL 返回与该方法契约一致的数据结构。
6. IF Data_Access_Layer 方法调用失败或所请求的数据不存在，THEN THE Data_Access_Layer SHALL 返回结构化错误对象，该对象包含可区分失败原因的错误类型标识，且不返回部分或不完整的业务数据结构。

### 需求 6：单一用户应用框架与导航

**用户故事（User Story）:** 作为单一用户，我希望通过统一的导航在监控、账户、数据与交易功能之间切换，以便在一个应用中完成所有管理操作。

#### 验收标准（Acceptance Criteria）

1. THE Web_UI SHALL 提供导航入口，包含且仅包含设备监控、账户信息、充放电数据与电力交易四个功能区域，且每个入口均可点击触发跳转。
2. WHILE 用户处于任一功能区域，THE Web_UI SHALL 保持导航始终可见且不被页面内容遮挡。
3. WHEN 用户从任一功能区域选择另一功能区域的导航入口，THE Web_UI SHALL 在 2 秒内切换至所选功能区域，并对当前所选区域的导航入口呈现选中态标记。
4. THE Platform SHALL 将 User 的注册数量上限设为 1，并将所有 Device、Account_Profile、Charge_Discharge_Record 与 Trading_Strategy 数据归属于该单一 User。
5. WHILE 任一功能区域的数据正在从 API_Layer 加载且未超过 10 秒，THE Web_UI SHALL 显示加载中状态指示。
6. IF 任一功能区域的数据加载失败或超过 10 秒未返回，THEN THE Web_UI SHALL 停止加载中指示、显示错误提示、提供重试入口，并保留该区域已有内容不被清空。
