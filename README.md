# AgentHub Desktop

AgentHub Desktop 是面向 Windows 11 的本地 Agent 管理工具。

阶段2当前完成的内容：

- Sidecar 常驻编排层
- 中央配置 `config/agents.json`
- 多个 Agent 并行运行，同一个 Agent 同时只允许一个实例
- 模型别名到真实模型名的映射
- 环境变量注入预览
- 运行、终止、刷新恢复和 Sidecar 状态显示

阶段2暂不包含：Hermes 调度、任务时间线、共享 Skills、Git Worktree 和设置页。

## 运行

双击项目根目录的 `启动开发预览.bat`。

这个脚本会先加载 Visual Studio 2022 的 Windows 编译工具，然后执行
`npm run tauri dev`。Tauri 会在启动界面之前自动构建 Sidecar。

也可以在已经初始化 Visual Studio C++ 工具环境的终端中运行：

```powershell
npm run tauri dev
```

## 修改 Agent 配置

配置入口是：

```text
config/agents.json
```

虽然扩展名是 `.json`，但内容支持 `//` 注释，方便说明每个字段的作用。
修改后不需要重启应用，打开 Agent 下拉或重新启动 Agent 时会自动重新读取。

主要字段：

- `agents`：Agent 清单、启动命令、参数、默认模型和工作目录
- `model_aliases`：给用户看的模型档次，以及每个 Agent 对应的真实模型名
- `env_injection`：启动 Agent 时注入的环境变量模板
- `cc_switch.base_url`：CC Switch 的本地路由地址
- `cc_switch.api_key_env`：保存 API Key 的系统环境变量名

可用模板占位符：

- `{model}`：别名解析后的真实模型名
- `{base_url}`：`cc_switch.base_url`
- `{api_key}`：`cc_switch.api_key_env` 指向的系统环境变量

路径规则：

- `cwd` 相对于 `config/agents.json` 所在目录解析
- `command` 和 `args` 原样交给系统启动，不做占位符替换

## CC Switch

CC Switch 需要用户自行启动并配置路由。阶段2只把地址和密钥注入给
Agent，不会主动发送模型请求；真实模型请求会在后续阶段接入。

如果没有设置 `CC_SWITCH_API_KEY`，Agent 仍然可以启动，但注入摘要会提示
该密钥未设置。

## 密钥显示规则

阶段2的验证脚本 `scripts/env-dump.js` 只显示：

- 非密钥环境变量的完整值
- 密钥是否设置，以及长度

例如：

```text
ANTHROPIC_AUTH_TOKEN=已设置（共 42 位）
```

不会显示密钥原文。Agent 输出通道本身是原样转发的；接入真实 CLI 后，
需要重新评估 CLI 自己是否会打印敏感信息。

## 测试延时字段

`start_delay_ms` 和 `stop_delay_ms` 只用于测试和演示，会把“正在启动”或
“正在终止”状态故意拉长。日常使用请保持 `0`。

## 配置损坏时的行为

- 整体语法错误：界面显示带行号的错误，但已经运行的 Agent 仍可查看和终止
- 单个 Agent 配置错误：只禁用这个 Agent，不影响其它 Agent
- 改回正确配置后无需重启，重新加载即可恢复

## 当前配置位置说明

开发模式下读取项目根目录的 `config/agents.json`。打包安装后的配置复制到
用户配置目录这一项留到阶段6处理，当前不实现。
