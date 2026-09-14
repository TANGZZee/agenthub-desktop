# AgentHub Desktop 项目开发任务书

> **致 AI 编程 Agent**：  
> 你正在为一个不懂编程的用户从零构建一个 Tauri 桌面应用。请严格按阶段实现，每次只完成一个阶段，确保可运行、可验收。不要一次性写完所有代码。  
> 用户会测试每个阶段并反馈现象，你根据反馈调整后再进入下一阶段。  
> 代码注释请用中文，关键逻辑写清“为什么这么做”。

---

## 1. 项目概述

**项目名**：AgentHub Desktop  
**目标**：一个桌面窗口，聚合多个 AI Agent，由 Hermes 担任大管家调度。  
**核心 Agent**：
- **Hermes**：Supervisor，理解用户任务，输出结构化调度计划。
- **Pi**：用户已有的 Agent，擅长数据分析、脚本、文件操作。
- **Claude Code**：擅长代码生成、重构、架构设计。
- **Codex**：擅长快速补全、单元测试、小范围修改。

**关键约束**：
- 用户无法使用 Claude 和 OpenAI 官方模型，必须通过 **CC Switch** 将 Claude Code / Codex 路由到国产模型。
- 用户不懂编程，所有功能需可视化、可验收。
- 不采用群聊模式，改用任务时间线。
- 所有 Agent 按需启动，任务完成后关闭，不常驻。

---

## 2. 技术栈

| 层级      | 技术                                 |
| --------- | ------------------------------------ |
| 桌面框架  | Tauri v2                             |
| 前端      | React + TypeScript + Vite            |
| UI 组件   | shadcn/ui + Tailwind CSS             |
| Rust 后端 | Tauri Core（仅进程管理、事件转发）   |
| 编排层    | Node.js + TypeScript（Sidecar 进程） |
| 进程通信  | stdio + JSON-RPC                     |
| 模型路由  | CC Switch（外部应用，负责协议转换）  |
| 持久化    | SQLite（Tauri SQL 插件）             |
| Git 操作  | simple-git（Sidecar 内）             |

---

## 3. 系统架构

┌─────────────────────────────────────────────┐
│ Tauri 桌面窗口（React + TypeScript） │
│ ┌──────────────┐ ┌─────────────────────┐ │
│ │ 任务输入框 │ │ 任务时间线 / 设置界面 │ │
│ └──────┬───────┘ └──────────┬──────────┘ │
│ │ invoke │ event │
│ ┌──────▼──────────────────────▼──────────┐ │
│ │ Rust 后端（Tauri Core） │ │
│ │ · 窗口管理 · 进程生命周期 · 事件转发 │ │
│ └──────────────────┬─────────────────────┘ │
└─────────────────────┼───────────────────────┘
│ stdio / JSON-RPC
┌────────────▼────────────┐
│ Sidecar 编排层 │
│ （Node.js / TypeScript）│
│ · Agent 池管理 │
│ · 解析 Hermes 调度 JSON │
│ · Skills 同步 │
│ · 模型配置注入 │
│ · Worktree 管理 │
└───┬────┬────┬────┬──────┘
│ │ │ │
Hermes Pi Claude Codex
(进程) (进程)(进程) (进程)
│ │ │ │
└────┴────┴────┘
│
┌───────▼────────┐
│ CC Switch │
│ （本地模型路由）│
└────────────────┘

**关键原则**：

- Rust 后端只做进程管理和事件转发，不写编排逻辑。
- 编排逻辑全部在 Sidecar（Node.js）中。
- 前端只负责展示和输入。
- CC Switch 作为外部依赖，由用户启动，Sidecar 负责在启动 Worker 前确保路由可用。

---

## 4. 核心概念定义

| 概念                     | 说明                                                         |
| ------------------------ | ------------------------------------------------------------ |
| **Agent**                | 一个可独立运行的进程，通过 stdio 与 Sidecar 通信。           |
| **Supervisor（Hermes）** | 接收用户自然语言，输出结构化调度 JSON 的 Agent。             |
| **Worker**               | 执行具体子任务的 Agent（Pi、Claude、Codex）。                |
| **Sidecar**              | Node.js 进程，负责解析调度、管理 Agent 池、注入配置、管理 Worktree。 |
| **CC Switch**            | 外部桌面应用，将 Claude Code / Codex 的 API 请求路由到国产模型。 |
| **Worktree**             | Git 工作树，每个 Agent 任务在独立目录中运行，避免冲突。      |
| **任务时间线**           | 前端展示调度计划、子任务状态、模型、结果的列表。             |

---

## 5. 分阶段开发任务

### 阶段 1：Tauri 壳 + 单 Agent 进程管理 + 流式输出

**任务**：
1. 创建 Tauri v2 + React + TypeScript 项目，使用 Vite。
2. 实现一个按钮，点击后启动一个测试子进程（如 `ping 127.0.0.1` 或一个简单的 Node 脚本）。
3. 将子进程的 stdout 实时流式显示在前端。
4. 提供“终止进程”按钮。

**产出**：
- 可运行的 Tauri 应用。
- Rust 命令：`spawn_test_agent`、`kill_test_agent`。
- 前端页面：一个输入框（显示命令）、启动/终止按钮、输出区域。

**验收标准**：
- 点击启动，输出区域实时滚动显示子进程输出。
- 点击终止，进程立即结束。
- 关闭窗口后进程不残留。

**给 Agent 的指令**：
> 请先创建 Tauri 项目，然后实现上述功能。完成后告诉我如何运行，并列出你创建的文件。不要继续下一阶段。

---

### 阶段 2：Sidecar 编排层 + 中央配置

**任务**：
1. 创建 Node.js + TypeScript Sidecar 项目，放在 `sidecar/` 目录。
2. Sidecar 通过 stdio 与 Rust 通信，使用 JSON-RPC 格式。
3. 创建中央配置文件 `config/agents.json`，包含 Agent 列表、模型别名、Provider 环境变量引用。
4. Sidecar 提供方法：`startAgent(agentId, task, model)`，读取配置，启动对应 Agent 进程，注入环境变量（如 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 等，指向 CC Switch）。
5. Rust 后端提供命令 `start_agent`，转发给 Sidecar，并将输出流回前端。

**产出**：
- `sidecar/` 项目，编译为可执行文件。
- `config/agents.json` 示例文件。
- Tauri 命令 `start_agent`、`stop_agent`。
- 前端界面：选择 Agent、输入任务、启动按钮。

**验收标准**：
- 修改 `config/agents.json` 中的模型别名，启动 Agent 时环境变量随之改变（可在 Agent 启动脚本中打印环境变量验证）。
- 能启动一个模拟 Agent（如一个打印环境变量的 Node 脚本），输出显示在前端。

**给 Agent 的指令**：
> 实现 Sidecar 和中央配置。注意：CC Switch 是外部应用，Sidecar 只需设置环境变量指向 CC Switch 的本地地址（默认 `http://127.0.0.1:xxxx`，具体端口由用户配置）。完成后告诉我如何测试。不要继续下一阶段。

---

### 阶段 3：Hermes 调度 + 任务时间线

**任务**：
1. 实现 Hermes Supervisor 模块（可以是 Sidecar 内的一个函数，调用 LLM API）。
2. Hermes 的 System Prompt 要求输出结构化 JSON 调度计划，格式如下：
```json
{
  "plan": [
    {
      "id": "task-1",
      "agent": "pi",
      "model": "fast",
      "reason": "简单数据统计，用便宜模型",
      "task": "统计 data.csv 的行数和缺失值",
      "depends_on": []
    }
  ]
}
```

3.Sidecar 解析 JSON，按 `depends_on` 顺序启动 Worker，收集输出。

4.前端实现“任务时间线”：展示每个子任务的 Agent、模型、状态（等待/进行/完成/出错）、流式输出摘要、最终结果。

5.用户只与 Hermes 对话，Hermes 的调度过程和 Worker 结果都显示在时间线中。

**产出**：

- Hermes 调用逻辑（使用 CC Switch 路由的模型）。
- 调度 JSON 解析器。
- 任务时间线 React 组件。

**验收标准**：

- 输入“分析 data.csv 并写报告”，时间线显示：任务1（Pi，fast）、任务2（Claude，powerful，依赖任务1），依次执行。
- 每个任务的状态和模型可见。
- 最终结果整合显示。

**给 Agent 的指令**：

> 实现 Hermes 调度和时间线。Hermes 的模型也通过 CC Switch 路由，使用 `config/agents.json` 中的 `hermes` 配置。完成后告诉我如何模拟测试（可以先用假的 JSON 输出代替真实 LLM 调用）。不要继续下一阶段。

------

### 阶段 4：共享 Skills

**任务**：

1. 创建 `shared-skills/` 目录，每个 Skill 一个文件夹，内含 `SKILL.md` 和 `meta.yaml`。
2. `meta.yaml` 声明该 Skill 同步到哪些 Agent。
3. 为每个 Agent 写适配器（`adapters/claude-adapter.ts`、`codex-adapter.ts`、`pi-adapter.ts`），在 Agent 启动前将共享 Skill 转换成对应格式，放到 Agent 能识别的目录。
4. 支持热更新：修改共享 Skill 后，下次 Agent 启动自动生效。

**产出**：

- `shared-skills/` 示例（至少两个 Skill）。
- 适配器代码。
- Sidecar 启动 Agent 前调用适配器。

**验收标准**：

- 修改 `shared-skills/数据分析/SKILL.md`，然后启动 Pi 和 Claude 执行相关任务，两者行为都体现新 Skill 内容。
- 适配器不覆盖 Agent 原有配置，只追加/合并。

**给 Agent 的指令**：

> 实现共享 Skills 系统。适配器要小心处理，不要破坏 Agent 原有配置文件。完成后告诉我如何验证。不要继续下一阶段。

------

### 阶段 5：Git Worktree 隔离

**任务**：

1. 每个 Agent 任务启动时，在 `<project>/.agenthub/<task-id>` 创建独立 Git Worktree。
2. Agent 的工作目录设置为该 Worktree。
3. 任务完成后，保留 Worktree，用户可选择合并分支或删除。
4. 前端提供简单的 Worktree 管理界面（列表、合并、删除）。

**产出**：

- Worktree 创建/删除逻辑（Sidecar 内使用 simple-git）。
- 前端 Worktree 列表。

**验收标准**：

- 同时启动两个 Agent 修改同一文件，互不冲突。
- 任务完成后能看到两个分支，可选择合并其中一个。

**给 Agent 的指令**：

> 实现 Git Worktree 隔离。注意处理 Git 仓库不存在时的错误提示。完成后告诉我如何测试。不要继续下一阶段。

------

### 阶段 6：打包与优化

**任务**：

1. 将 Sidecar 编译为可执行文件，打包进 Tauri 应用。
2. 生成 Windows / macOS / Linux 安装包。
3. 优化启动速度、内存占用、错误处理。
4. 编写用户使用说明（中文），放在 `README.md`。

**产出**：

- 安装包。
- `README.md` 使用说明。

**验收标准**：

- 安装后能正常启动，所有功能可用。
- 关闭应用后无残留进程。

**给 Agent 的指令**：

> 完成打包和优化。确保 CC Switch 的依赖在 README 中说明清楚（用户需自行启动 CC Switch 并配置路由）。完成后项目结束。

------

## 6. 关键文件与配置示例

### 6.1 `config/agents.json`

json

```
{
  "agents": {
    "hermes": {
      "command": "node",
      "args": ["agents/hermes.js"],
      "default_model": "balanced",
      "temperature": 0.3
    },
    "pi": {
      "command": "node",
      "args": ["agents/pi.js"],
      "default_model": "fast",
      "temperature": 0.1
    },
    "claude": {
      "command": "claude",
      "args": [],
      "default_model": "powerful",
      "temperature": 0.2
    },
    "codex": {
      "command": "codex",
      "args": [],
      "default_model": "balanced",
      "temperature": 0.1
    }
  },
  "model_aliases": {
    "fast": {
      "claude": "glm-4-flash",
      "codex": "deepseek-v4-flash",
      "pi": "haiku"
    },
    "balanced": {
      "claude": "glm-5.3",
      "codex": "qwen3-coder",
      "pi": "sonnet"
    },
    "powerful": {
      "claude": "glm-5.3",
      "codex": "doubao-seed-code",
      "pi": "opus"
    }
  },
  "cc_switch": {
    "base_url": "http://127.0.0.1:8787",
    "api_key_env": "CC_SWITCH_API_KEY"
  }
}
```



### 6.2 `shared-skills/` 结构

text

```
shared-skills/
├── 数据分析/
│   ├── SKILL.md
│   └── meta.yaml
├── 代码审查/
│   ├── SKILL.md
│   └── meta.yaml
└── adapters/
    ├── claude-adapter.ts
    ├── codex-adapter.ts
    └── pi-adapter.ts
```



`meta.yaml` 示例：

yaml

```
name: 数据分析
targets:
  - pi
  - claude
  - codex
```



### 6.3 Hermes 调度 JSON 格式

json

```
{
  "plan": [
    {
      "id": "task-1",
      "agent": "pi",
      "model": "fast",
      "reason": "简单统计，用便宜模型",
      "task": "统计 data.csv 行数和缺失值",
      "depends_on": []
    },
    {
      "id": "task-2",
      "agent": "claude",
      "model": "powerful",
      "reason": "需要重构复杂模块",
      "task": "重构数据清洗模块",
      "depends_on": ["task-1"]
    }
  ]
}
```



------

## 7. 给 AI 编程 Agent 的协作指令

1. **每次只做一个阶段**。完成一个阶段后，停下来，告诉用户如何运行、如何验收、你创建了哪些文件。
2. **等待用户反馈**。用户测试后会把现象告诉你，你根据反馈修改，确认通过后再进入下一阶段。
3. **不要引入不必要的复杂框架**。如果可以用简单方案，先用简单方案。
4. **代码注释用中文**，关键逻辑写清楚“为什么这么做”。
5. **所有配置和 Skill 文件放在项目根目录**，方便用户手动查看和修改。
6. **CC Switch 是外部依赖**，你不需要实现它，只需要在启动 Worker 前设置好环境变量，并在 README 中说明用户需要自行启动 CC Switch 并配置路由。
7. **用户不懂编程**，所以每个阶段完成后，请用通俗语言解释你做了什么，以及用户应该如何测试。

**启动提示词（用户可直接复制给你）**：

> 我要从零开始做一个 Tauri 桌面应用，叫 AgentHub Desktop。目标是聚合多个 AI Agent（Hermes、Pi、Claude Code、Codex），Hermes 当大管家调度。我不懂编程，请你按项目规划书分阶段实现。第一阶段只做 Tauri 壳 + 单 Agent 进程管理 + 流式输出。请先告诉我你会创建哪些文件、用什么命令，然后开始写代码。每完成一个可运行的小步，就停下来让我测试。

------

## 8. 总验收标准

- □ 

  一个窗口内可输入任务，Hermes 输出调度计划。

- □ 

  任务时间线显示每个子任务的 Agent、模型、状态、结果。

- □ 

  修改共享 Skill 后，不同 Agent 行为同步更新。

- □ 

  修改模型配置后，Agent 实际使用模型改变（通过 CC Switch 路由）。

- □ 

  Hermes 能根据任务复杂度指定不同模型。

- □ 

  多个 Agent 并行改代码不冲突，支持 Worktree 合并。

- □ 

  所有 Agent 按需启动，任务完成后进程关闭。

- □ 

  应用可打包安装，本地运行，API Key 安全存储。

- □ 

  CC Switch 的使用在 README 中说明清楚。

  ## 9. 风险与对策

  | 风险                         | 对策                                                        |
  | :--------------------------- | :---------------------------------------------------------- |
  | 不同 Agent 的 CLI 参数不统一 | Sidecar 为每个 Agent 写适配器，统一接口                     |
  | 模型命名不一致               | 中央配置加 `model_aliases` 映射层                           |
  | CC Switch 未启动导致请求失败 | Sidecar 启动 Worker 前检查 CC Switch 端点，失败时在界面提示 |
  | Agent 进程异常退出           | Sidecar 监听退出码，Hermes 决定重试或换 Agent               |
  | 多 Agent 改代码冲突          | Git Worktree 隔离，强制每个任务独立目录                     |
  | 用户不懂技术，无法调试       | 每阶段可运行、可验收；Agent 提供中文注释和验证步骤          |
  | 项目范围膨胀                 | 严格按阶段推进，非目标功能一律推迟                          |

**本任务书是活文档。每完成一个阶段，可根据实际情况调整后续内容。**