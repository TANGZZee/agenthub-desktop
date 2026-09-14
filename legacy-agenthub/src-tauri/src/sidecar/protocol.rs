use serde::Serialize;
use serde_json::Value;

const VALID_ERROR_KINDS: &[&str] = &[
    "nodeMissing",
    "sidecarCrashed",
    "sidecarTimeout",
    "internal",
    "configInvalid",
    "agentNotFound",
    "alreadyRunning",
    "agentStartFailed",
    "stopFailed",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdError {
    pub kind: String,
    pub message: String,
}

impl CmdError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
        }
    }
}

/// JSON-RPC 读线程递给发起请求的通道内容。
pub enum RpcReply {
    Result(Value),
    Error(CmdError),
}

/// Sidecar 的结构化错误映射成前端可分支的 CmdError。
///
/// data.kind 缺失或不在白名单内时统一降级为 internal，并把原始报文留在
/// message 中，避免靠匹配人可读文案来猜错误类型。
pub fn cmd_error_from_rpc(error: &Value) -> CmdError {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Sidecar 返回了未提供 message 的错误")
        .to_string();

    let kind = error
        .get("data")
        .and_then(|data| data.get("kind"))
        .and_then(Value::as_str)
        .filter(|kind| VALID_ERROR_KINDS.contains(kind));

    match kind {
        Some(kind) => CmdError::new(kind, message),
        None => CmdError::new(
            "internal",
            format!("Sidecar 错误缺少有效 kind；原始错误：{error}"),
        ),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatusEvent {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub job_object: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInfo {
    pub available: bool,
    pub job_object: bool,
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentsResult {
    pub agents: Value,
    pub config: Value,
    pub sidecar: SidecarInfo,
}
