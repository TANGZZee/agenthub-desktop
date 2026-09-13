import { adapterRegistry } from "./adapter-registry";

const pi = adapterRegistry.get("pi");
if (!pi) throw new Error("Pi 适配器未注册");
const piArgs = pi.buildArgs({ taskId: "test", prompt: "read only", cwd: "." }, { id: "pi", label: "Pi", defaultModel: "fast", modelAliases: ["fast"], configured: true, phase: "idle", runId: null, resolvedModel: null });
if (!piArgs.includes("--tools") || !piArgs.includes("read,grep,find,ls")) throw new Error("Pi 只读工具白名单异常");

const codex = adapterRegistry.get("codex");
if (!codex) throw new Error("Codex 适配器未注册");
const codexArgs = codex.buildArgs({ taskId: "test", prompt: "read only", cwd: "." }, { id: "codex", label: "Codex", defaultModel: "balanced", modelAliases: ["balanced"], configured: true, phase: "idle", runId: null, resolvedModel: null });
if (!codexArgs.includes("--sandbox") || !codexArgs.includes("read-only") || codexArgs.includes("--dangerously-bypass-approvals-and-sandbox")) throw new Error("Codex 安全参数异常");

console.log("adapter smoke test passed");
