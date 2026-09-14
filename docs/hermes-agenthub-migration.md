# Hermes 主控迁移架构

AgentHub Desktop 以 `fathah/hermes-desktop` 为 Hermes 主控桌面底座，并通过受控编排扩展接入 Pi、Codex、Claude Code 等外部 Worker。

## 当前基线

本分支基于 `fathah/hermes-desktop` 的 `main` 分支，保留 MIT 许可证和上游版权声明。原 AgentHub 实现完整保存在 `legacy-agenthub/`，仅作为迁移参考，不作为运行时依赖。

底座采用 Electron + React + TypeScript，主进程负责 Hermes Gateway、安装、配置、SQLite、IPC 和外部进程边界；渲染进程负责聊天、会话、设置、Kanban、Office 和 Worker 可观察性。

## 产品角色

Hermes 是用户唯一的主要对话入口，负责理解目标、形成计划、决定是否委托以及汇总结果。Pi、Codex、Claude Code 和其它 CLI Agent 是可配置的外部 Worker，负责执行 Hermes 分派的具体步骤。

用户可以查看 Worker 的状态、输出、任务关系、证据、错误和审批，但默认不需要在多个 Agent 的独立聊天界面之间来回切换。

## 运行边界

Hermes Desktop 不应再用规则或关键词替用户决定 Worker。Hermes 通过受控的 AgentHub 工具请求编排动作，主进程校验请求后才启动或操作 Worker。

建议的工具边界如下：

- `worker.list`：列出已安装、已启用和正在运行的 Worker。
- `worker.start`：按任务、工作目录和权限策略启动 Worker。
- `worker.prompt`：向指定 Worker 发送结构化任务。
- `worker.read`：读取经过限制和脱敏的输出摘要。
- `worker.wait`：等待完成、阻塞、失败或超时状态。
- `worker.cancel`：取消指定运行。
- `worker.retry`：按策略重试失败运行。
- `worker.inspect`：读取版本、能力和运行证据。

所有 Worker 调用都必须记录任务 ID、Worker ID、运行 ID、状态转换和必要的摘要；不得记录 API Key、Token、完整认证头或未经限制的环境变量。

## 数据关系

一次 Hermes 主会话可以关联一个主任务和多个 Worker 步骤：

```text
Hermes 会话
  ├── 用户消息
  ├── Hermes 计划
  ├── Worker 步骤
  │   ├── Worker 配置
  │   ├── 运行尝试
  │   ├── 输出摘要
  │   ├── 证据
  │   └── 最终状态
  └── Hermes 汇总回复
```

Hermes Profile 与 Worker Profile 必须分开。Hermes Profile 管理 Hermes 自身的模型、人格、记忆和工具；Worker Profile 管理外部 Agent 的启动入口、模型、权限、工作目录、超时和恢复方式。

## 迁移范围

直接复用 Hermes Desktop 的聊天、流式 Gateway、会话数据库、Profiles、Provider、模型、Tools、Skills、MCP、Memory、Soul、Schedules、Kanban、Office、诊断、备份和打包能力。

从旧 AgentHub 迁移 Agent 注册表、Worker 启动适配器、权限策略、状态映射、任务关联、Office 桥接和中文产品需求。旧版 Tauri 壳、旧版 Hermes 占位适配器和规则式 `planner` 不进入新的主路径。

## 分阶段验收

### M0：底座切换

确认新 Electron 底座可以安装依赖、通过类型检查、启动开发界面，并且旧版代码可从 `legacy-agenthub/` 找到。

### M1：单 Worker 闭环

新增一个受控 Worker 适配器，完成 Hermes 请求、主进程准入、Worker 启动、输出摘要、完成状态和 Hermes 可见结果的闭环。测试必须覆盖启动失败、超时、取消和敏感信息过滤。

### M2：多 Worker 编排

接入 Pi、Codex 和 Claude Code 的独立配置，支持并行步骤、依赖关系、重试、阻塞和人工确认。Hermes 可以通过统一工具选择 Worker，而不是前端硬编码分派。

### M3：可观察性

把 Worker 运行记录接入 Kanban、任务时间线和 Office。用户可以从 Hermes 消息跳转到任务详情，查看实时状态和有限输出，并能安全取消或重试。

### M4：稳定性和发布

完成 Windows 进程树清理、恢复策略、权限复验、密钥审计、全量测试、中文界面核对和安装包验证。

## 上游同步规则

新功能优先放入清晰的 AgentHub 扩展模块，避免改动 Hermes Desktop 的核心协议和既有会话逻辑。保留上游 remote 和提交来源；每次同步后运行类型检查、测试、构建和文档链接检查。
