# AgentHub 智能体清单

这个目录是**候选智能体清单的唯一真源**，两个地方读它：

| 读它的地方 | 怎么读 |
| --- | --- |
| **网页**（GitHub Pages） | `index.html` 用 `fetch` 读同目录的 `agenthub-market.json` |
| **应用内**（Hermes One 的 Workers 页） | 主进程从 GitHub 拉这份 JSON，校验后缓存到本地磁盘 |

改一个智能体 = 改这个 JSON 并推送。**不用重新打包应用**，网页也会立刻更新。

---

## 文件

| 文件 | 作用 |
| --- | --- |
| `agenthub-market.json` | 清单数据（唯一真源，手工维护） |
| `index.html` | 清单网页，自包含、无构建步骤 |
| `README.md` | 本文档 |

应用侧还有一份**生成的**内置兜底表（`src/main/agenthub/market.generated.ts`），
由 `npm run catalog:sync` 从 JSON 生成 —— 断网或首次启动时用它。**不要手改那份文件。**

---

## 一条硬规则：这里写不了「能不能用」

JSON 里**没有也不许有** `runner` 字段。校验脚本会直接报错。

原因：某个智能体到底能不能被 Hermes One 调度，取决于**那个 CLI 的只读参数是否已在
本机被人工审核过**。这份文件是网络数据，只能描述、不能授权。审核名单写死在应用里
（`src/main/agenthub/profiles.ts` 的 `REVIEWED_RUNNER_IDS`），目前只有 `pi`。

所以网页和应用都必须把清单里的条目标注为「仅列出」，不许暗示"装完就能用"。

---

## 怎么加一个智能体

1. 在 `agenthub-market.json` 的 `agents` 数组里加一条（字段见下表）。
2. 跑校验：
   ```bash
   npm run catalog:check
   ```
3. 同步内置兜底表：
   ```bash
   npm run catalog:sync
   ```
4. 提交。

### 必须人工核实的内容

自动化只能查格式，查不了真假。下面这些**必须你自己去官网确认**，否则清单会误导人：

- `docsUrl` —— 官方文档地址，能打开、且确实是这个工具
- `installHint` —— 真实可执行的安装命令；不确定就写「按 XX 官方文档安装」而不要瞎编
- `binaries` —— 装完之后，命令行里能敲的名字（`where` / `which` 能找到的那个）

> 不要从搜索结果里抓安装命令。抓来的命令可能过期、可能指向错误的包，而用户会直接复制执行。

---

## 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 稳定标识。小写字母/数字/`._-`，如 `claude-code`。**一旦发布不要改**（应用按它记录接入状态） |
| `rank` | | 列表排序，越小越前。**全清单内不可重复** |
| `name` | ✅ | 显示名，保留原文，如 `Claude Code` |
| `vendor` | ✅ | 厂商/作者 |
| `category` | ✅ | 见下方「分类」 |
| `role` | ✅ | 一句话定位，`{zh, en}` 都要 |
| `description` | ✅ | 一段介绍，`{zh, en}` 都要，≤400 字 |
| `docsUrl` | ✅ | **必须 `https:`**（http 会被校验拒绝） |
| `installHint` | ✅ | 安装命令或指引。**必须单行**：它会被复制进终端，多行等于多条命令 |
| `binaries` | ✅ | `{win: [...], unix: [...]}`，至少一个非空。只写裸文件名，不能带路径或通配符 |
| `permissions` | | 权限标签，见下方「权限标签」 |

### 分类（`category`）

| 值 | 网页显示 |
| --- | --- |
| `official` | 官方 |
| `open-source` | 开源 |
| `vendor-cli` | 厂商 CLI |
| `china-ecosystem` | 国产生态 |

### 权限标签（`permissions`）

只能从这几个里选，未知值会被校验拒绝：

| 值 | 网页显示 | 含义 |
| --- | --- | --- |
| `read` | 读取 | 读取文件内容 |
| `grep` | 搜索内容 | 在文件内容里搜索 |
| `find` | 查找文件 | 按名字找文件 |
| `ls` | 列目录 | 列出目录 |
| `project-root` | 限于项目目录 | 工作目录被限制在项目根目录 |
| `read-only-sandbox` | 官方只读沙箱 | 使用该 CLI 官方的只读沙箱模式 |
| `no-write` | 不写入 | 不修改文件 |
| `planned` | 尚未审核 | 还没审核过它的运行参数 |

> 这些标签目前是**描述性**的：它们说明这个 CLI 有相应的能力，不代表 Hermes One 已经在用。
> 在 Runner 通过审核之前，实际能力是"无"。

---

## 校验脚本

```bash
node scripts/validate-market-catalog.mjs [路径]
```

检查项：必填字段、id 字符集、`https:` 链接、长度上限、重复 id / 重复 rank、
`binaries` 是否为裸文件名、`permissions` 是否为已知值、`installHint` 是否单行、
**是否偷塞了 `runner` 字段**。

它和应用里的解析器（`src/shared/agenthub-market.ts`）是**刻意分开写两遍**的：
脚本防手写错误（提交前），解析器防网络和缓存被篡改（运行时），职责不同。

---

## 网页托管（已开启）

GitHub Pages 已开启：Source = **Deploy from a branch**，
Branch = `migration/hermes-desktop-base`，Folder = `/docs`。

地址：

```
https://tangzzee.github.io/agenthub-desktop/catalog/
```

`docs/.nojekyll` 是必需的：`docs/` 下有两个上游内部文档含 `{{` 片段，老式的 Jekyll
构建会解析失败（GitHub 只报一句 `Page build failed.`）。这个空文件让 GitHub 跳过
Jekyll，直接按静态文件发布。

> `docs/` 下还有内部工程文档，从 `/docs` 发布会把它们一并公开；仓库是公开的，
> 所以没有新增暴露。若以后想收紧，改成只发布 `docs/catalog` 的 Actions 工作流即可。

本地预览（`file://` 打开会被浏览器拦住读数据，要用本地服务器）：

```bash
cd docs/catalog && python -m http.server 8000
# 然后访问 http://localhost:8000/
```
