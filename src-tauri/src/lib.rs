use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};

use encoding_rs::GBK;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod sidecar;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MONITOR_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CmdError {
    kind: String,
    message: String,
}

impl CmdError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOutputPayload {
    run_id: u64,
    stream: &'static str,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExitPayload {
    run_id: u64,
    code: Option<i32>,
    killed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatus {
    running: bool,
    run_id: Option<u64>,
}

struct RunInfo {
    child: Child,
    killed: Arc<AtomicBool>,
    run_id: u64,
}

#[derive(Default)]
struct AgentState {
    slot: Mutex<Option<RunInfo>>,
}

fn lock_slot(state: &AgentState) -> MutexGuard<'_, Option<RunInfo>> {
    // 即使某条读线程意外中断，也尽量恢复状态锁，避免整个进程管理永久卡死。
    state
        .slot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn resolve_test_agent_script(app: &AppHandle) -> Result<PathBuf, CmdError> {
    // 打包后优先从资源目录查找；资源映射确保脚本位于 scripts 子目录。
    let resource_script = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("scripts").join("test-agent.js"));

    if let Some(path) = resource_script {
        if path.is_file() {
            return normalized_script_path(path);
        }
    }

    // 开发模式直接回到项目目录，避免必须打包后才能测试。
    let dev_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("test-agent.js");

    if dev_script.is_file() {
        return normalized_script_path(dev_script);
    }

    Err(CmdError::new(
        "spawnFailed",
        format!("找不到测试脚本：{}", dev_script.display()),
    ))
}

fn normalized_script_path(path: PathBuf) -> Result<PathBuf, CmdError> {
    // 先规范化盘符、空格和 ..，避免 Node 在 Windows 上把长路径误识别成盘符。
    path.canonicalize()
        .map_err(|error| CmdError::new("spawnFailed", format!("无法解析测试脚本路径：{error}")))
}

fn node_command(script_path: &Path) -> Result<Command, CmdError> {
    let script_dir = script_path
        .parent()
        .ok_or_else(|| CmdError::new("spawnFailed", "测试脚本路径缺少所在目录"))?;
    let script_name = script_path
        .file_name()
        .ok_or_else(|| CmdError::new("spawnFailed", "测试脚本路径缺少文件名"))?;

    let mut command = Command::new("node");
    // 只传短文件名，并显式指定工作目录，彻底绕开带空格绝对路径的 Windows 参数解析问题。
    command.current_dir(script_dir).arg(script_name);
    Ok(command)
}

fn command_for_preset(preset: &str, script_path: &Path) -> Result<Command, CmdError> {
    let mut command = match preset {
        "node" => node_command(script_path)?,
        "node-fast-exit" => {
            let mut command = node_command(script_path)?;
            command.arg("--fast-exit");
            command
        }
        "ping" => {
            let mut command = Command::new("ping");
            command.arg("127.0.0.1").arg("-n").arg("20");
            command
        }
        _ => {
            return Err(CmdError::new(
                "unknownPreset",
                format!("未知测试预设：{preset}"),
            ));
        }
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    Ok(command)
}

fn decode_line(bytes: &[u8]) -> String {
    // 先严格检查 UTF-8；失败后再按 GBK 解码，兼容中文 Windows 的 ping 输出。
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (decoded, _, _) = GBK.decode(bytes);
            decoded.into_owned()
        }
    }
}

fn stream_output<R: Read + Send + 'static>(
    app: AppHandle,
    stream_name: &'static str,
    reader: R,
    run_id: u64,
) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();

    loop {
        buffer.clear();

        let read_count = match reader.read_until(b'\n', &mut buffer) {
            Ok(count) => count,
            Err(_) => break,
        };

        if read_count == 0 {
            break;
        }

        if buffer.last() == Some(&b'\n') {
            buffer.pop();
        }
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }

        let _ = app.emit(
            "diagnostic-output",
            AgentOutputPayload {
                run_id,
                stream: stream_name,
                line: decode_line(&buffer),
            },
        );
    }
}

fn monitor_process(
    app: AppHandle,
    run_id: u64,
    killed: Arc<AtomicBool>,
    stdout_handle: thread::JoinHandle<()>,
    stderr_handle: thread::JoinHandle<()>,
) {
    let exit_status = loop {
        let wait_result = {
            let state = app.state::<AgentState>();
            let mut slot = lock_slot(&state);

            let Some(info) = slot.as_mut() else {
                return;
            };

            if info.run_id != run_id {
                return;
            }

            info.child.try_wait()
        };

        match wait_result {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(MONITOR_INTERVAL),
            Err(_) => {
                // 查询失败时主动收尾；即使 kill 失败，也必须继续释放状态槽。
                let state = app.state::<AgentState>();
                let mut slot = lock_slot(&state);
                if let Some(info) = slot.as_mut() {
                    if info.run_id == run_id {
                        let _ = info.child.kill();
                    }
                }
                break None;
            }
        }
    };

    // 必须等输出线程读到管道 EOF，确保最后几行先于退出事件到达前端。
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    {
        let state = app.state::<AgentState>();
        let mut slot = lock_slot(&state);
        if slot
            .as_ref()
            .map(|info| info.run_id == run_id)
            .unwrap_or(false)
        {
            // 先清槽、后发事件：前端收到退出事件后可以立刻启动下一次运行。
            *slot = None;
        }
    }

    let _ = app.emit(
        "diagnostic-exit",
        AgentExitPayload {
            run_id,
            code: exit_status.and_then(|status| status.code()),
            killed: killed.load(Ordering::SeqCst),
        },
    );
}

#[tauri::command]
fn spawn_test_agent(
    app: AppHandle,
    state: State<'_, AgentState>,
    preset: String,
    run_id: u64,
) -> Result<(), CmdError> {
    // 全程只持锁一次，检查槽位与创建进程之间不会留下双击竞争窗口。
    let mut slot = lock_slot(&state);

    if slot.is_some() {
        return Err(CmdError::new("alreadyRunning", "已有测试进程正在运行"));
    }

    let script_path = resolve_test_agent_script(&app)?;
    let mut command = command_for_preset(&preset, &script_path)?;
    let mut child = command
        .spawn()
        .map_err(|error| CmdError::new("spawnFailed", format!("启动测试进程失败：{error}")))?;

    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        CmdError::new("spawnFailed", "无法读取测试进程的标准输出")
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        CmdError::new("spawnFailed", "无法读取测试进程的错误输出")
    })?;

    let killed = Arc::new(AtomicBool::new(false));
    slot.replace(RunInfo {
        child,
        killed: Arc::clone(&killed),
        run_id,
    });

    let stdout_app = app.clone();
    let stdout_handle = thread::spawn(move || stream_output(stdout_app, "stdout", stdout, run_id));

    let stderr_app = app.clone();
    let stderr_handle = thread::spawn(move || stream_output(stderr_app, "stderr", stderr, run_id));

    let monitor_app = app.clone();
    thread::spawn(move || {
        monitor_process(monitor_app, run_id, killed, stdout_handle, stderr_handle)
    });

    // 子进程的孙进程清理需要 Windows Job Object，按计划留到阶段2处理。
    Ok(())
}

#[tauri::command]
fn kill_test_agent(state: State<'_, AgentState>) -> Result<(), CmdError> {
    let mut slot = lock_slot(&state);

    let Some(info) = slot.as_mut() else {
        // 进程已经结束或从未启动，终止请求视为已经达成。
        return Ok(());
    };

    if info.killed.load(Ordering::SeqCst) {
        return Ok(());
    }

    info.killed.store(true, Ordering::SeqCst);

    match info.child.kill() {
        Ok(()) => Ok(()),
        Err(kill_error) => match info.child.try_wait() {
            Ok(Some(_)) => {
                // 进程恰好自行结束：撤销主动终止标记，让退出事件显示正常完成。
                info.killed.store(false, Ordering::SeqCst);
                Ok(())
            }
            _ => {
                info.killed.store(false, Ordering::SeqCst);
                Err(CmdError::new(
                    "killFailed",
                    format!("终止测试进程失败：{kill_error}"),
                ))
            }
        },
    }
}

#[tauri::command]
fn get_agent_status(state: State<'_, AgentState>) -> Result<AgentStatus, CmdError> {
    let slot = lock_slot(&state);

    match slot.as_ref() {
        Some(info) => Ok(AgentStatus {
            running: true,
            run_id: Some(info.run_id),
        }),
        None => Ok(AgentStatus {
            running: false,
            run_id: None,
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AgentState::default())
        .manage(sidecar::SidecarClient::new())
        .invoke_handler(tauri::generate_handler![
            spawn_test_agent,
            kill_test_agent,
            get_agent_status,
            sidecar::start_agent,
            sidecar::stop_agent,
            sidecar::list_agents,
            sidecar::submit_task,
            sidecar::list_tasks,
            sidecar::cancel_task,
            sidecar::list_task_events
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AgentState>() {
                let mut slot = lock_slot(&state);
                if let Some(info) = slot.as_mut() {
                    // 窗口关闭时只清理直接子进程；孙进程由阶段2的 Job Object 处理。
                    let _ = info.child.kill();
                }
            }

            if let Some(sidecar_client) = app_handle.try_state::<sidecar::SidecarClient>() {
                sidecar_client.shutdown(app_handle);
            }
        }
    });
}
