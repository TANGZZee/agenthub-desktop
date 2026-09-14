# 同步 Hermes 上游更新（AgentHub fork 流程）

本仓库以 `fathah/hermes-desktop` 为底座，自己的 AgentHub 功能叠加在其上。
本文说明如何在**不丢失自己改动**的前提下持续吸收上游更新，以及为什么不需要
在 GitHub 上做真正的 fork。

## 远端布局

```
origin   → https://github.com/TANGZZee/agenthub-desktop    （你的仓库，改动推这里）
upstream → https://github.com/fathah/hermes-desktop        （原项目，只拉不推）
```

- `origin/main`：上游最后一次同步时的快照（不要直接在上面开发）。
- `origin/migration/hermes-desktop-base`：**主开发分支**，AgentHub 全部工作在这里。
- `origin/legacy/tauri-agenthub`：旧 Tauri 版本的存档，只读。
- 上游永远只通过 `upstream` 远端**拉取**；本仓库对上游没有写权限，也不需要。

## 为什么不用 GitHub fork

fork 唯一带来的额外能力是网页上的「Sync fork」按钮；真正的同步质量取决于
**怎么合并**（只 merge，不 reset、不 force-push）和**代码放在哪**。这两点本仓库
已经占优：AgentHub 的 15 个新文件（`src/main/agenthub/`、`screens/Workers/`、
`src/shared/agenthub.ts`、`resources/agenthub/`、AgentHub 测试）与上游完全不重叠，
天然不会冲突。若日后仍想要镜像 fork，另建 `TANGZZee/hermes-desktop` 指向上游即可，
本仓库与脚本不受影响。

## 日常同步（推荐顺序）

```powershell
# 1. 只看不动手：上游有哪些新提交、会碰哪些文件、哪里可能冲突
npm run sync:upstream

# 2. 确认没问题后，一键合并 + 验证
npm run sync:upstream:all

# 3.（可选）只跑验证，或只看自己改过哪些上游文件
npm run sync:upstream:verify
npm run sync:upstream:report
```

脚本行为（`scripts/hermes-upstream-sync.ps1`）：

- **拒绝脏工作树**：必须先 commit/stash，绝不在未提交改动之上合并。
- **只 merge**：从不 rebase / reset / force-push；不写 `origin/main` 与 legacy 分支。
- **先列热区再动手**：把「上游改了 × 我们也改过」的文件在合并前点名。
- **冲突即中止**：默认自动 `git merge --abort`，保持工作树可用；
  加 `-KeepConflicts` 才保留冲突现场手工解决。
- **合并后自动验证**：Node/Web 类型检查、AgentHub + IPC + preload 测试、
  AgentHub 范围 ESLint；装了 `lat` CLI 则附带 `lat check`。
- **永不自动推送**：验证通过后由人工确认再 `git push origin <branch>`。

## 冲突热区（截至 2026-02）

我们只在上游自有的这些文件里动过刀；上游若也改了它们，合并时会点名：

| 文件                                                               | 我们改了什么                                 |
| ------------------------------------------------------------------ | -------------------------------------------- |
| `src/main/ipc/register.ts`                                         | agenthub-dispatch / catalog / set-model 通道 |
| `src/preload/index.ts(.d.ts)`                                      | 暴露 agenthubCatalog\* API                   |
| `src/main/hermes.ts`                                               | 注入 AGENTHUB_WORKER_URL/TOKEN               |
| `src/main/app/start.ts`                                            | 退出时关闭编排器与 loopback 服务             |
| `src/renderer/src/screens/Layout/Layout.tsx`                       | Workers 导航入口与页面挂载                   |
| `src/renderer/src/assets/main.css`                                 | 追加在文件末尾的 `.workers-*` 样式           |
| `src/renderer/src/screens/Chat/slash/desktopCommands.ts`           | `/workers` 命令                              |
| `src/shared/i18n/locales/*/navigation.ts`                          | 每个语言包各加一行 `workers`                 |
| `.gitignore`、`lat.md/lat.md`、`docs/hermes-agenthub-migration.md` | 文档与忽略项                                 |

解决原则：**两边的意图都保留**——上游的新行为照收，我们的 AgentHub 接线
（dispatch 通道、preload API、导航入口）不删。语言包冲突几乎总是「两边都在
对象尾部加键」，两边都留即可；`main.css` 我们的块整体在文件末尾，上游改动
通常可直接并入。拿不准时先跑 `npm run sync:upstream:report` 对照。

## 冲突手工处理模板

```powershell
npm run sync:upstream:all -KeepConflicts   # 或直接 powershell -File scripts/hermes-upstream-sync.ps1 sync -KeepConflicts
git status --short                          # 看 !! 标记的文件
npm run sync:upstream:all -- -KeepConflicts   # 或 powershell -File scripts/hermes-upstream-sync.ps1 sync -KeepConflicts
git add <files>
git commit                                  # 结束合并
npm run sync:upstream:verify                # 必须全绿
git push origin migration/hermes-desktop-base
```

放弃并回到合并前：

```powershell
git merge --abort          # 合并进行中
git reset --hard ORIG_HEAD # 合并已提交但验证失败
```

## 现状快照（2026-02）

- 基线：上游 `cff1f44`（0.7.7），`merge-base` 与上游 HEAD 一致，尚无新上游提交。
- 我们：`migration/hermes-desktop-base` @ `27229a1`（AgentHub 全量）已推送；
  `legacy/tauri-agenthub` @ `3015d41`（旧版 18 个提交）已推送。
- `lat` CLI 未安装：`lat check` 目前靠脚本自动跳过；安装后自动纳入验证。
