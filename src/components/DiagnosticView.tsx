import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ChevronDown,
  Play,
  RotateCcw,
  Square,
  Terminal,
} from "lucide-react";

import { errKind, errMessage } from "../lib/errors";

type Phase =
  | "subscribing"
  | "unknown"
  | "idle"
  | "starting"
  | "running"
  | "terminating"
  | "finished";

type ResultKind = "success" | "failed" | "terminated";
type PresetId = "node" | "ping" | "node-fast-exit";

interface Preset {
  id: PresetId;
  label: string;
  command: string;
}

interface OutputLine {
  runId: number;
  stream: "stdout" | "stderr";
  line: string;
}

interface ExitEvent {
  runId: number;
  code: number | null;
  killed: boolean;
}

interface AgentStatus {
  running: boolean;
  runId: number | null;
}

const PRESETS: Preset[] = [
  {
    id: "node",
    label: "Node 测试脚本",
    command: "node scripts\\test-agent.js",
  },
  {
    id: "ping",
    label: "Ping 测试",
    command: "ping 127.0.0.1 -n 20",
  },
  {
    id: "node-fast-exit",
    label: "Node 快速退出",
    command: "node scripts\\test-agent.js --fast-exit",
  },
];

function statusLabel(phase: Phase, result: ResultKind | null): string {
  if (phase === "subscribing") return "正在连接";
  if (phase === "unknown") return "状态未知";
  if (phase === "idle") return "空闲";
  if (phase === "starting") return "正在启动";
  if (phase === "running") return "运行中";
  if (phase === "terminating") return "正在终止";

  if (result === "success") return "已完成";
  if (result === "failed") return "运行失败";
  if (result === "terminated") return "已终止";
  return "已结束";
}

function statusTone(phase: Phase, result: ResultKind | null): string {
  if (phase === "starting" || phase === "running") return "running";
  if (phase === "terminating") return "terminating";
  if (phase === "finished") return `finished ${result ?? "terminated"}`;
  return "idle";
}

export function DiagnosticView() {
  const [phaseState, setPhaseState] = useState<Phase>("subscribing");
  const [outputs, setOutputs] = useState<OutputLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultKind | null>(null);
  const [selectedPreset, setSelectedPreset] =
    useState<PresetId>("node");
  const [showBackToLatest, setShowBackToLatest] = useState(false);

  const phaseRef = useRef<Phase>("subscribing");
  const runIdRef = useRef<number | null>(null);
  const mountGenRef = useRef(0);
  const opRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn[] | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  function setPhase(next: Phase) {
    phaseRef.current = next;
    setPhaseState(next);
  }

  function beginOp() {
    return ++opRef.current;
  }

  function opValid(token: number) {
    return opRef.current === token;
  }

  function alive(gen: number) {
    return mountGenRef.current === gen;
  }

  function appendLine(payload: OutputLine) {
    setOutputs((current) => [...current, payload]);
  }

  function applyExit(payload: ExitEvent) {
    if (phaseRef.current === "finished") return;

    opRef.current += 1;
    runIdRef.current = payload.runId;
    setPhase("finished");
    setResult(
      payload.killed
        ? "terminated"
        : payload.code === 0
          ? "success"
          : "failed",
    );
    setError(null);
  }

  function syncStatus(gen: number) {
    const token = beginOp();

    invoke<AgentStatus>("get_agent_status")
      .then((status) => {
        if (!alive(gen) || !opValid(token)) return;
        if (
          phaseRef.current !== "unknown" &&
          phaseRef.current !== "subscribing"
        ) {
          return;
        }

        if (status.running && status.runId !== null) {
          runIdRef.current = status.runId;
          setPhase("running");
          setError(null);
          return;
        }

        if (!status.running) {
          runIdRef.current = null;
          setPhase("idle");
          setError(null);
          return;
        }

        setPhase("unknown");
        setError("后端状态信息不完整，请重新同步");
      })
      .catch((reason: unknown) => {
        if (!alive(gen) || !opValid(token)) return;
        setPhase("unknown");
        setError(`无法读取后端状态：${errMessage(reason)}`);
      });
  }

  useEffect(() => {
    const gen = ++mountGenRef.current;
    setPhase("subscribing");
    setError(null);

    Promise.all([
      listen<OutputLine>("diagnostic-output", (event) => {
        if (event.payload.runId !== runIdRef.current) return;
        appendLine(event.payload);
      }),
      listen<ExitEvent>("diagnostic-exit", (event) => {
        if (event.payload.runId !== runIdRef.current) {
          if (
            phaseRef.current === "unknown" ||
            phaseRef.current === "subscribing"
          ) {
            runIdRef.current = event.payload.runId;
            applyExit(event.payload);
          }
          return;
        }

        applyExit(event.payload);
      }),
    ])
      .then((unlistenFns) => {
        if (!alive(gen)) {
          unlistenFns.forEach((unlisten) => unlisten());
          return;
        }

        unlistenRef.current = unlistenFns;
        syncStatus(gen);
      })
      .catch(() => {
        if (!alive(gen)) return;
        setPhase("subscribing");
        setError("事件订阅失败，请重启应用");
      });

    return () => {
      mountGenRef.current += 1;
      unlistenRef.current?.forEach((unlisten) => unlisten());
      unlistenRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current || outputRef.current === null) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [outputs]);

  async function start(preset: PresetId) {
    if (phaseRef.current !== "idle" && phaseRef.current !== "finished") {
      return;
    }

    const token = beginOp();
    const gen = mountGenRef.current;
    const runId = Date.now();

    runIdRef.current = runId;
    autoScrollRef.current = true;
    setShowBackToLatest(false);
    setOutputs([]);
    setError(null);
    setResult(null);
    setPhase("starting");

    try {
      await invoke("spawn_test_agent", { preset, runId });
      if (!alive(gen) || !opValid(token)) return;
      setPhase("running");
    } catch (reason: unknown) {
      if (!alive(gen) || !opValid(token)) return;

      if (errKind(reason) === "alreadyRunning") {
        setError("检测到后台仍有进程运行，正在重新同步…");
        setPhase("unknown");
        syncStatus(mountGenRef.current);
        return;
      }

      runIdRef.current = null;
      setPhase("idle");
      setError(errMessage(reason));
    }
  }

  async function kill() {
    if (phaseRef.current !== "running") return;

    const token = beginOp();
    const gen = mountGenRef.current;
    setError(null);
    setPhase("terminating");

    try {
      await invoke("kill_test_agent");
    } catch (reason: unknown) {
      if (!alive(gen) || !opValid(token)) return;
      setPhase("running");
      setError(errMessage(reason));
    }
  }

  function handleOutputScroll() {
    const element = outputRef.current;
    if (element === null) return;

    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    autoScrollRef.current = atBottom;
    setShowBackToLatest(!atBottom);
  }

  function scrollToLatest() {
    const element = outputRef.current;
    if (element === null) return;

    autoScrollRef.current = true;
    setShowBackToLatest(false);
    element.scrollTop = element.scrollHeight;
  }

  const canStart = phaseState === "idle" || phaseState === "finished";
  const canKill = phaseState === "running";
  const showRetry = phaseState === "unknown";
  const currentPreset =
    PRESETS.find((preset) => preset.id === selectedPreset) ?? PRESETS[0];

  return (
    <div className="diagnostic-view">
      <header className="app-header">
        <div>
          <h1>诊断控制台</h1>
          <p>阶段 1 · 单 Agent 进程测试</p>
        </div>

        <div className="status-summary">
          <span className={`status-dot ${statusTone(phaseState, result)}`} />
          <span>{statusLabel(phaseState, result)}</span>
        </div>
      </header>

      <main className="workspace">
        <section className="control-panel">
          <div className="control-grid">
            <div className="field">
              <label htmlFor="preset-select">测试预设</label>
              <div className="select-wrap">
                <select
                  id="preset-select"
                  value={selectedPreset}
                  onChange={(event) =>
                    setSelectedPreset(
                      event.currentTarget.value as PresetId,
                    )
                  }
                  disabled={!canStart}
                >
                  {PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="select-icon"
                  size={16}
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                disabled={!canStart}
                onClick={() => void start(selectedPreset)}
              >
                <Play size={16} aria-hidden="true" />
                启动
              </button>
              <button
                type="button"
                className="button button-stop"
                disabled={!canKill}
                onClick={() => void kill()}
              >
                <Square size={15} aria-hidden="true" />
                终止
              </button>
            </div>
          </div>

          <div className="command-preview">
            <span>实际命令</span>
            <code>{currentPreset.command}</code>
          </div>

          {showRetry && (
            <button
              type="button"
              className="text-button"
              onClick={() => syncStatus(mountGenRef.current)}
            >
              <RotateCcw size={15} aria-hidden="true" />
              重新同步
            </button>
          )}

          {error !== null && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="output-panel">
          <div className="output-header">
            <div className="output-title">
              <Terminal size={16} aria-hidden="true" />
              <span>实时输出</span>
            </div>
            <span>{outputs.length} 行</span>
          </div>

          <div
            className="output-scroll"
            ref={outputRef}
            onScroll={handleOutputScroll}
          >
            {outputs.length === 0 ? (
              <div className="empty-output">
                <Terminal
                  size={42}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span>等待启动测试进程</span>
              </div>
            ) : (
              outputs.map((output, index) => (
                <div
                  className={`console-line ${output.stream}`}
                  key={`${output.runId}-${index}`}
                >
                  <span className="stream-label">
                    {output.stream === "stderr" ? "ERR" : "OUT"}
                  </span>
                  <span className="line-text">{output.line}</span>
                </div>
              ))
            )}
          </div>

          {showBackToLatest && (
            <button
              type="button"
              className="back-to-latest"
              onClick={scrollToLatest}
            >
              <ArrowDown size={15} aria-hidden="true" />
              回到最新
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
