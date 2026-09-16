# Hermes 引擎本地补丁记录

本文件记录**对 Hermes 引擎（非本项目仓库）所做的本地修改**。引擎是第三方代码，位于：

```
%LOCALAPPDATA%\hermes\hermes-agent\
```

`hermes update` 会覆盖这些改动，升级后需要重新应用。原始文件均已备份为 `*.orig-backup`。

---

## 补丁 1：启动时弹出 PowerShell 蓝窗

**文件**：`hermes_cli\gateway.py`
**函数**：`_windows_scheduled_task_state()`（约 1908 行）
**备份**：`hermes_cli\gateway.py.orig-backup`

### 现象

每次启动 Hermes One，会出现一到两个蓝色的 PowerShell 窗口，一闪而过。

### 根因

该函数用裸 `subprocess.run()` 调用 `powershell.exe` 查计划任务状态。Windows 会为它分配一个控制台窗口。因为 gateway 在每次启动时都会调用它，用户就看到弹窗。

引擎里其余 25 处同类调用都通过 `windows_hide_flags()`（内部是 `CREATE_NO_WINDOW`，0x08000000）或 `bounded_probe_run()` 规避了这个问题——只有这一处（以及同类直达 `run` 调用）漏了。

### 修复

```python
from hermes_cli._subprocess_compat import windows_hide_flags
result = subprocess.run(
    [powershell, "-NoProfile", "-Command", ps_cmd],
    capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=10,
    creationflags=windows_hide_flags(),
)
```

### 验证方式

让子进程自己报告是否有控制台窗口（`GetConsoleWindow()`）：

```
不带标志 → 句柄 4130260   （存在窗口 = 会闪）
带标志   → 句柄 0         （无窗口）
```

### 升级后如何重新应用

```powershell
$f = "$env:LOCALAPPDATA\hermes\hermes-agent\hermes_cli\gateway.py"
Select-String -Path $f -Pattern 'creationflags=windows_hide_flags'
# 空 → 补丁已被覆盖，需重新加上 creationflags 参数
```
