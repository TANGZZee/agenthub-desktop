mod job;
pub mod protocol;

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, RecvTimeoutError, SyncSender},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};

use encoding_rs::GBK;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use self::{
    job::JobHandle,
    protocol::{
        cmd_error_from_rpc, CmdError, ListAgentsResult, RpcReply, SidecarInfo, SidecarStatusEvent,
    },
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MONITOR_INTERVAL: Duration = Duration::from_millis(2_000);
const SIDECAR_SCRIPT: &str = "sidecar/dist/sidecar.cjs";
const SIDECAR_CONFIG: &str = "config/agents.json";

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct PendingRequest {
    generation: u64,
    sender: SyncSender<RpcReply>,
}

struct SidecarProc {
    generation: u64,
    child: Child,
    stdin: Option<ChildStdin>,
    alive: bool,
    job: Option<JobHandle>,
    job_object_ok: bool,
}

struct SidecarClientInner {
    proc: Mutex<Option<SidecarProc>>,
    current_gen: AtomicU64,
    pending: Mutex<HashMap<u64, PendingRequest>>,
    next_id: AtomicU64,
    start_lock: Mutex<()>,
}

#[derive(Clone)]
pub struct SidecarClient {
    inner: Arc<SidecarClientInner>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn decode_pipe_line(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (decoded, _, _) = GBK.decode(bytes);
            decoded.into_owned()
        }
    }
}

fn dev_project_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
}

fn node_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }

    path
}

fn resolve_resource(app: &AppHandle, relative: &str) -> Result<PathBuf, CmdError> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource = resource_dir.join(relative);
        if resource.is_file() {
            return Ok(node_compatible_path(resource));
        }
    }

    if let Some(project_root) = dev_project_root() {
        let development = project_root.join(relative);
        if development.is_file() {
            return Ok(node_compatible_path(development));
        }
    }

    Err(CmdError::new(
        "internal",
        format!("找不到 Sidecar 资源：{relative}"),
    ))
}

fn emit_status(app: &AppHandle, available: bool, job_object: bool, message: Option<String>) {
    let _ = app.emit(
        "sidecar-status",
        SidecarStatusEvent {
            available,
            message,
            job_object,
        },
    );
}

fn handle_sidecar_death(
    inner: &Arc<SidecarClientInner>,
    app: &AppHandle,
    generation: u64,
    message: String,
) {
    let start_guard = lock(&inner.start_lock);

    if inner.current_gen.load(Ordering::Acquire) != generation {
        return;
    }

    let should_emit = {
        let mut proc_guard = lock(&inner.proc);
        let Some(proc) = proc_guard.as_mut() else {
            return;
        };

        if proc.generation != generation || !proc.alive {
            return;
        }

        if let Some(job) = proc.job.as_ref() {
            if let Err(error) = job.terminate() {
                eprintln!("[sidecar] 终止 Job Object 失败：{error}");
            }
        }

        proc.alive = false;
        proc.job_object_ok = false;
        true
    };

    if should_emit {
        emit_status(app, false, false, Some(message));
    }

    // 新 Sidecar 开始时必须先拿 start_lock，因此这里发出的 false 一定排在
    // 下一代的 true 之前。释放锁后再清理旧请求，避免与 pending 形成锁嵌套。
    drop(start_guard);

    let mut pending = lock(&inner.pending);
    let old_ids: Vec<u64> = pending
        .iter()
        .filter_map(|(id, request)| (request.generation == generation).then_some(*id))
        .collect();
    for id in old_ids {
        pending.remove(&id);
    }
}

fn spawn_stdout_reader(
    inner: Arc<SidecarClientInner>,
    app: AppHandle,
    generation: u64,
    stdout: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();
            let count = match reader.read_until(b'\n', &mut buffer) {
                Ok(count) => count,
                Err(error) => {
                    eprintln!("[sidecar] 读取 stdout 失败：{error}");
                    break;
                }
            };

            if count == 0 {
                break;
            }

            if inner.current_gen.load(Ordering::Acquire) != generation {
                return;
            }

            if buffer.last() == Some(&b'\n') {
                buffer.pop();
            }
            if buffer.last() == Some(&b'\r') {
                buffer.pop();
            }

            let text = decode_pipe_line(&buffer);
            let message: Value = match serde_json::from_str(&text) {
                Ok(message) => message,
                Err(error) => {
                    eprintln!("[sidecar] 丢弃无法解析的 stdout 行：{error}");
                    continue;
                }
            };

            if let Some(id) = message.get("id").and_then(Value::as_u64) {
                let reply = if let Some(error) = message.get("error") {
                    RpcReply::Error(cmd_error_from_rpc(error))
                } else {
                    RpcReply::Result(message.get("result").cloned().unwrap_or(Value::Null))
                };

                let sender = {
                    let mut pending = lock(&inner.pending);
                    pending.remove(&id).and_then(|request| {
                        (request.generation == generation).then_some(request.sender)
                    })
                };

                if let Some(sender) = sender {
                    let _ = sender.send(reply);
                }
                continue;
            }

            let method = message
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let params = message.get("params").cloned().unwrap_or(Value::Null);

            match method {
                "agent/output" => {
                    let _ = app.emit("agent-output", params);
                }
                "agent/state" => {
                    let _ = app.emit("agent-state", params);
                }
                "agent/exit" => {
                    let _ = app.emit("agent-exit", params);
                }
                "agent/error" => {
                    let _ = app.emit("agent-error", params);
                }
                "sidecar/log" => {
                    let level = params
                        .get("level")
                        .and_then(Value::as_str)
                        .unwrap_or("info");
                    let message = params.get("message").and_then(Value::as_str).unwrap_or("");
                    eprintln!("[sidecar {level}] {message}");
                }
                _ => {
                    eprintln!("[sidecar] 未知通知：{method}");
                }
            }
        }

        handle_sidecar_death(
            &inner,
            &app,
            generation,
            "Sidecar 输出通道已关闭".to_string(),
        );
    });
}

fn spawn_stderr_reader(
    inner: Arc<SidecarClientInner>,
    generation: u64,
    stderr: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();
            let count = match reader.read_until(b'\n', &mut buffer) {
                Ok(count) => count,
                Err(_) => break,
            };
            if count == 0 {
                break;
            }

            if inner.current_gen.load(Ordering::Acquire) != generation {
                return;
            }

            if buffer.last() == Some(&b'\n') {
                buffer.pop();
            }
            if buffer.last() == Some(&b'\r') {
                buffer.pop();
            }
            eprintln!("[sidecar stderr] {}", decode_pipe_line(&buffer));
        }
    });
}

fn spawn_guardian(inner: Arc<SidecarClientInner>, app: AppHandle, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(MONITOR_INTERVAL);

        if inner.current_gen.load(Ordering::Acquire) != generation {
            return;
        }

        let exited = {
            let mut proc_guard = lock(&inner.proc);
            let Some(proc) = proc_guard.as_mut() else {
                return;
            };

            if proc.generation != generation || !proc.alive {
                return;
            }

            match proc.child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => false,
                Err(_) => true,
            }
        };

        if exited {
            handle_sidecar_death(&inner, &app, generation, "Sidecar 进程已退出".to_string());
            return;
        }
    });
}

impl SidecarClient {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(SidecarClientInner {
                proc: Mutex::new(None),
                current_gen: AtomicU64::new(0),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                start_lock: Mutex::new(()),
            }),
        }
    }

    fn shared(&self) -> Arc<SidecarClientInner> {
        Arc::clone(&self.inner)
    }

    fn is_alive(&self) -> bool {
        let current_gen = self.inner.current_gen.load(Ordering::Acquire);
        lock(&self.inner.proc)
            .as_ref()
            .is_some_and(|proc| proc.alive && proc.generation == current_gen)
    }

    fn status(&self) -> (bool, bool) {
        let current_gen = self.inner.current_gen.load(Ordering::Acquire);
        lock(&self.inner.proc)
            .as_ref()
            .filter(|proc| proc.alive && proc.generation == current_gen)
            .map_or((false, false), |proc| (true, proc.job_object_ok))
    }

    fn ensure_started(&self, app: &AppHandle) -> Result<(), CmdError> {
        if self.is_alive() {
            return Ok(());
        }

        let _start_guard = lock(&self.inner.start_lock);
        if self.is_alive() {
            return Ok(());
        }

        self.spawn_locked(app)
    }

    fn spawn_locked(&self, app: &AppHandle) -> Result<(), CmdError> {
        let script = resolve_resource(app, SIDECAR_SCRIPT)?;
        let config = resolve_resource(app, SIDECAR_CONFIG)?;
        let project_root = dev_project_root().unwrap_or_else(|| {
            script
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        });

        let (job, initial_job_message) = match JobHandle::create() {
            Ok(job) => (Some(job), None),
            Err(error) => (
                None,
                Some(format!("进程清理降级：创建 Job Object 失败（{error}）")),
            ),
        };

        let mut command = Command::new("node");
        command
            .arg(&script)
            .arg("--config")
            .arg(&config)
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|error| {
            let kind = if error.kind() == std::io::ErrorKind::NotFound {
                "nodeMissing"
            } else {
                "sidecarCrashed"
            };
            CmdError::new(kind, format!("启动 Sidecar 失败：{error}"))
        })?;

        let mut job_message = initial_job_message;
        let mut job = job;
        let mut job_object_ok = false;

        if let Some(job_handle) = job.as_ref() {
            match job_handle.assign(&child) {
                Ok(()) => job_object_ok = true,
                Err(error) => {
                    job_message = Some(format!("进程清理降级：Job Object 接管失败（{error}）"));
                    job = None;
                }
            }
        }

        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            CmdError::new("sidecarCrashed", "无法获取 Sidecar stdin")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            CmdError::new("sidecarCrashed", "无法获取 Sidecar stdout")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            let _ = child.kill();
            CmdError::new("sidecarCrashed", "无法获取 Sidecar stderr")
        })?;

        let generation = self.inner.current_gen.fetch_add(1, Ordering::AcqRel) + 1;
        let inner = self.shared();

        spawn_stdout_reader(inner.clone(), app.clone(), generation, stdout);
        spawn_stderr_reader(inner.clone(), generation, stderr);
        spawn_guardian(inner.clone(), app.clone(), generation);

        *lock(&self.inner.proc) = Some(SidecarProc {
            generation,
            child,
            stdin: Some(stdin),
            alive: true,
            job,
            job_object_ok,
        });

        emit_status(app, true, job_object_ok, job_message);
        Ok(())
    }

    fn call(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CmdError> {
        self.ensure_started(app)?;

        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let generation = self.inner.current_gen.load(Ordering::Acquire);
        let (sender, receiver) = sync_channel(1);

        lock(&self.inner.pending).insert(id, PendingRequest { generation, sender });

        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let frame = format!("{request}\n");

        let write_result = {
            let mut proc_guard = lock(&self.inner.proc);
            match proc_guard.as_mut() {
                Some(proc) if proc.alive && proc.generation == generation => {
                    match proc.stdin.as_mut() {
                        Some(stdin) => stdin
                            .write_all(frame.as_bytes())
                            .and_then(|_| stdin.flush()),
                        None => Err(std::io::Error::new(
                            std::io::ErrorKind::BrokenPipe,
                            "Sidecar stdin 已关闭",
                        )),
                    }
                }
                _ => Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Sidecar 当前不可用",
                )),
            }
        };

        if let Err(error) = write_result {
            lock(&self.inner.pending).remove(&id);
            return Err(CmdError::new(
                "sidecarCrashed",
                format!("向 Sidecar 发送请求失败：{error}"),
            ));
        }

        match receiver.recv_timeout(timeout) {
            Ok(RpcReply::Result(result)) => Ok(result),
            Ok(RpcReply::Error(error)) => Err(error),
            Err(RecvTimeoutError::Timeout) => {
                lock(&self.inner.pending).remove(&id);
                Err(CmdError::new("sidecarTimeout", "Sidecar 请求超时"))
            }
            Err(RecvTimeoutError::Disconnected) => {
                lock(&self.inner.pending).remove(&id);
                Err(CmdError::new("sidecarCrashed", "Sidecar 在响应前退出"))
            }
        }
    }

    /// 应用退出时先请求 Sidecar 自己清理，再关 stdin、等待、必要时强杀。
    pub fn shutdown(&self, app: &AppHandle) {
        if self.is_alive() {
            let _ = self.call(app, "shutdown", json!({}), Duration::from_secs(1));
        }

        let mut proc = lock(&self.inner.proc).take();
        let Some(proc) = proc.as_mut() else {
            return;
        };

        // 先关 stdin 触发 Sidecar 的 EOF 兜底，再等待，最后才强杀。
        drop(proc.stdin.take());

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while std::time::Instant::now() < deadline {
            if proc.child.try_wait().ok().flatten().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        if proc.child.try_wait().ok().flatten().is_none() {
            let _ = proc.child.kill();
        }

        if let Some(job) = proc.job.take() {
            let _ = job.terminate();
        }
    }
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, SidecarClient>,
    agent_id: String,
    prompt: String,
    model: Option<String>,
    run_id: u64,
) -> Result<Value, CmdError> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.call(
            &app,
            "startAgent",
            json!({
                "agentId": agent_id,
                "prompt": prompt,
                "model": model,
                "runId": run_id,
            }),
            Duration::from_secs(30),
        )
    })
    .await
    .map_err(|error| CmdError::new("internal", format!("启动任务失败：{error}")))?
}

#[tauri::command]
pub async fn stop_agent(
    app: AppHandle,
    state: State<'_, SidecarClient>,
    agent_id: String,
    run_id: u64,
) -> Result<(), CmdError> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.call(
            &app,
            "stopAgent",
            json!({
                "agentId": agent_id,
                "runId": run_id,
            }),
            Duration::from_secs(5),
        )
    })
    .await
    .map_err(|error| CmdError::new("internal", format!("终止任务失败：{error}")))??;

    Ok(())
}


#[tauri::command]
pub async fn submit_task(
    app: AppHandle,
    state: State<'_, SidecarClient>,
    proposal: Value,
) -> Result<Value, CmdError> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.call(&app, "taskSubmit", json!({ "proposal": proposal }), Duration::from_secs(10)))
        .await
        .map_err(|error| CmdError::new("internal", format!("提交任务失败：{error}")))?
}

#[tauri::command]
pub async fn list_tasks(
    app: AppHandle,
    state: State<'_, SidecarClient>,
) -> Result<Value, CmdError> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.call(&app, "taskList", json!({}), Duration::from_secs(10)))
        .await
        .map_err(|error| CmdError::new("internal", format!("读取任务失败：{error}")))?
}

#[tauri::command]
pub async fn cancel_task(
    app: AppHandle,
    state: State<'_, SidecarClient>,
    task_id: String,
) -> Result<Value, CmdError> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.call(&app, "taskCancel", json!({ "taskId": task_id }), Duration::from_secs(10)))
        .await
        .map_err(|error| CmdError::new("internal", format!("取消任务失败：{error}")))?
}\n\n#[tauri::command]
pub async fn list_agents(
    app: AppHandle,
    state: State<'_, SidecarClient>,
) -> Result<ListAgentsResult, CmdError> {
    let client = state.inner().clone();
    let status_client = client.clone();
    let value = tauri::async_runtime::spawn_blocking(move || {
        client.call(&app, "listAgents", json!({}), Duration::from_secs(10))
    })
    .await
    .map_err(|error| CmdError::new("internal", format!("读取 Agent 列表失败：{error}")))??;

    let version = value
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let agents = value
        .get("agents")
        .cloned()
        .ok_or_else(|| CmdError::new("internal", "Sidecar 的 listAgents 响应缺少 agents"))?;
    let config = value
        .get("config")
        .cloned()
        .ok_or_else(|| CmdError::new("internal", "Sidecar 的 listAgents 响应缺少 config"))?;
    let (available, job_object) = status_client.status();

    Ok(ListAgentsResult {
        agents,
        config,
        sidecar: SidecarInfo {
            available,
            job_object,
            version,
        },
    })
}
