import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  TAURI_COMMANDS,
  TAURI_EVENTS,
  type AgentErrorNotification,
  type AgentExitNotification,
  type AgentInfo,
  type AgentOutputNotification,
  type AgentStateNotification,
  type InjectedEnv,
  type ListAgentsResult,
  type SidecarStatusEvent,
} from "../../shared/protocol";
import { errKind, errMessage } from "../lib/errors";

export type ChannelPhase = "subscribing" | "ready" | "unknown";
export type AgentPhase =
  | "idle"
  | "starting"
  | "running"
  | "terminating"
  | "finished";
export type ResultKind = "success" | "failed" | "terminated";

export interface AgentRuntime {
  phase: AgentPhase;
  runId: number | null;
  /** 只有终态事件递增，用来作废旧操作。 */
  opToken: number;
  /** 任何写运行时记录的动作都会递增，用来判断快照是否过期。 */
  rev: number;
  result: ResultKind | null;
  modelAlias: string | null;
  resolvedModel: string | null;
  injectedEnv: InjectedEnv | null;
  cwd: string | null;
  lastError: string | null;
}

export type CatalogAgent = Omit<
  AgentInfo,
  "phase" | "runId" | "resolvedModel"
>;

export interface OutputLine extends AgentOutputNotification {
  key: string;
}

export interface SidecarDisplayStatus {
  available: boolean | null;
  jobObject: boolean | null;
  version: string;
  message: string | null;
}

export interface UseSidecarResult {
  channelPhase: ChannelPhase;
  agents: CatalogAgent[];
  runtimes: Record<string, AgentRuntime>;
  outputs: OutputLine[];
  sidecar: SidecarDisplayStatus;
  configError: string | null;
  connectionError: string | null;
  rosterLoading: boolean;
  refreshRoster: () => Promise<void>;
  startAgent: (
    agentId: string,
    prompt: string,
    model: string | null,
  ) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
}

const EMPTY_RUNTIME: AgentRuntime = {
  phase: "idle",
  runId: null,
  opToken: 0,
  rev: 0,
  result: null,
  modelAlias: null,
  resolvedModel: null,
  injectedEnv: null,
  cwd: null,
  lastError: null,
};

function runtimeFor(
  runtimes: Record<string, AgentRuntime>,
  agentId: string,
): AgentRuntime {
  return runtimes[agentId] ?? EMPTY_RUNTIME;
}

function phaseFromSnapshot(
  phase: AgentInfo["phase"],
): AgentPhase {
  return phase;
}

function resultFromExit(payload: AgentExitNotification): ResultKind {
  if (payload.killed) return "terminated";
  return payload.code === 0 ? "success" : "failed";
}

export function useSidecar(): UseSidecarResult {
  const [channelPhase, setChannelPhase] = useState<ChannelPhase>("subscribing");
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, AgentRuntime>>({});
  const [outputs, setOutputs] = useState<OutputLine[]>([]);
  const [sidecar, setSidecar] = useState<SidecarDisplayStatus>({
    available: null,
    jobObject: null,
    version: "",
    message: null,
  });
  const [configError, setConfigError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);

  const runtimesRef = useRef(runtimes);
  const agentsRef = useRef(agents);
  const channelPhaseRef = useRef<ChannelPhase>("subscribing");
  const mountGenRef = useRef(0);
  const rosterSeqRef = useRef(0);
  const lastAppliedSeqRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn[] | null>(null);
  const lastRunIdRef = useRef(0);
  const rebuildRuntimeOnNextRosterRef = useRef(false);

  const setChannel = useCallback((phase: ChannelPhase) => {
    channelPhaseRef.current = phase;
    setChannelPhase(phase);
  }, []);

  const patchRuntime = useCallback(
    (agentId: string, patch: Partial<AgentRuntime>) => {
      const next = { ...runtimesRef.current };
      const previous = next[agentId] ?? EMPTY_RUNTIME;

      // rev 默认递增；StartAck、事件和本地操作天然都会作废旧快照。
      next[agentId] = {
        ...previous,
        rev: previous.rev + 1,
        ...patch,
      };
      runtimesRef.current = next;
      setRuntimes(next);
    },
    [],
  );

  const patchCatalog = useCallback((next: CatalogAgent[]) => {
    agentsRef.current = next;
    setAgents(next);
  }, []);

  const nextRunId = useCallback(() => {
    const now = Date.now();
    const runId = now > lastRunIdRef.current ? now : lastRunIdRef.current + 1;
    lastRunIdRef.current = runId;
    return runId;
  }, []);

  const acceptRun = useCallback(
    (agentId: string, runId: number): boolean => {
      const current = runtimesRef.current[agentId];
      return !current || current.runId === null || current.runId === runId;
    },
    [],
  );

  const applyState = useCallback(
    (payload: AgentStateNotification) => {
      if (!acceptRun(payload.agentId, payload.runId)) return;

      const current = runtimeFor(runtimesRef.current, payload.agentId);
      if (
        current.runId === payload.runId &&
        current.phase === payload.phase &&
        current.resolvedModel === payload.resolvedModel
      ) {
        return;
      }

      // agent/state 是非终态广播：必须递增 rev，绝不能递增 opToken。
      patchRuntime(payload.agentId, {
        runId: payload.runId,
        phase: payload.phase,
        resolvedModel: payload.resolvedModel,
      });
    },
    [acceptRun, patchRuntime],
  );

  const applyExit = useCallback(
    (payload: AgentExitNotification) => {
      if (!acceptRun(payload.agentId, payload.runId)) return;

      const current = runtimeFor(runtimesRef.current, payload.agentId);
      if (
        current.runId === payload.runId &&
        current.phase === "finished"
      ) {
        return;
      }

      patchRuntime(payload.agentId, {
        runId: payload.runId,
        phase: "finished",
        result: resultFromExit(payload),
        resolvedModel: payload.resolvedModel,
        opToken: current.opToken + 1,
        lastError: null,
      });

      const catalogEntry = agentsRef.current.find(
        (agent) => agent.id === payload.agentId,
      );
      if (catalogEntry?.configured === false) {
        patchCatalog(
          agentsRef.current.filter((agent) => agent.id !== payload.agentId),
        );
      }
    },
    [acceptRun, patchCatalog, patchRuntime],
  );

  const applyError = useCallback(
    (payload: AgentErrorNotification) => {
      if (!acceptRun(payload.agentId, payload.runId)) return;

      const current = runtimeFor(runtimesRef.current, payload.agentId);
      if (
        current.runId === payload.runId &&
        current.phase === "finished"
      ) {
        return;
      }

      patchRuntime(payload.agentId, {
        runId: payload.runId,
        phase: "finished",
        result: "failed",
        resolvedModel: payload.resolvedModel,
        opToken: current.opToken + 1,
        lastError: payload.message,
      });
    },
    [acceptRun, patchRuntime],
  );

  const applyOutput = useCallback((payload: AgentOutputNotification) => {
    const current = runtimesRef.current[payload.agentId];
    if (!current || current.runId !== payload.runId) return;

    setOutputs((existing) => [
      ...existing,
      {
        ...payload,
        key: `${payload.agentId}-${payload.runId}-${existing.length}`,
      },
    ]);
  }, []);

  const applyRoster = useCallback(
    (result: ListAgentsResult) => {
      const metadata: CatalogAgent[] = result.agents.map(
        ({ phase: _phase, runId: _runId, resolvedModel: _model, ...rest }) =>
          rest,
      );
      patchCatalog(metadata);

      setSidecar({
        available: result.sidecar.available,
        jobObject: result.sidecar.jobObject,
        version: result.sidecar.version,
        message: null,
      });

      if (result.config.ok) {
        setConfigError(null);
      } else {
        setConfigError(result.config.error.message);
      }
    },
    [patchCatalog],
  );

  const applyRosterRuntime = useCallback(
    (
      result: ListAgentsResult,
      revAtRequest: Record<string, number | undefined>,
      channelAtRequest: ChannelPhase,
      forceRebuild: boolean,
    ) => {
      for (const snapshot of result.agents) {
        const current = runtimesRef.current[snapshot.id];
        const localRunId = current?.runId ?? null;
        const snapshotRunId = snapshot.runId;

        const identityAccepted =
          !current || localRunId === null || localRunId === snapshotRunId;

        // 本地已经是不同的一轮时，这份快照整体都旧了，不能只靠 rev 判断。
        if (!identityAccepted) continue;

        const revUnchanged =
          current?.rev === revAtRequest[snapshot.id];
        const canApplyPhase =
          (channelAtRequest !== "ready" || forceRebuild) && revUnchanged;

        const patch: Partial<AgentRuntime> = {
          runId: snapshotRunId,
          resolvedModel: snapshot.resolvedModel,
        };

        if (canApplyPhase) {
          patch.phase = phaseFromSnapshot(snapshot.phase);
          patch.result =
            snapshot.phase === "idle" ? null : current?.result ?? null;
          patch.lastError =
            snapshot.phase === "idle" ? null : current?.lastError ?? null;
        }

        const changed =
          current?.runId !== patch.runId ||
          current?.resolvedModel !== patch.resolvedModel ||
          (patch.phase !== undefined && current?.phase !== patch.phase);

        if (changed) {
          patchRuntime(snapshot.id, patch);
        }
      }
    },
    [patchRuntime],
  );

  const refreshRoster = useCallback(async () => {
    const gen = mountGenRef.current;
    const seq = ++rosterSeqRef.current;
    const channelAtRequest = channelPhaseRef.current;
    const forceRebuild = rebuildRuntimeOnNextRosterRef.current;
    const revAtRequest: Record<string, number | undefined> =
      forceRebuild
        ? {}
        : Object.fromEntries(
            Object.entries(runtimesRef.current).map(([agentId, runtime]) => [
              agentId,
              runtime.rev,
            ]),
          );

    setRosterLoading(true);

    try {
      const result = await invoke<ListAgentsResult>(
        TAURI_COMMANDS.listAgents,
      );

      if (mountGenRef.current !== gen || seq < lastAppliedSeqRef.current) {
        return;
      }

      lastAppliedSeqRef.current = seq;
      if (forceRebuild) {
        runtimesRef.current = {};
        setRuntimes({});
        setOutputs([]);
      }
      applyRoster(result);
      applyRosterRuntime(
        result,
        revAtRequest,
        channelAtRequest,
        forceRebuild,
      );
      rebuildRuntimeOnNextRosterRef.current = false;
      setChannel("ready");
      setConnectionError(null);
    } catch (error) {
      if (mountGenRef.current !== gen) return;

      const message = errMessage(error);
      if (channelPhaseRef.current !== "ready") {
        setChannel("unknown");
      }
      setConnectionError(message);
    } finally {
      if (mountGenRef.current === gen) {
        setRosterLoading(false);
      }
    }
  }, [applyRoster, applyRosterRuntime, setChannel]);

  useEffect(() => {
    const gen = ++mountGenRef.current;
    setChannel("subscribing");
    setConnectionError(null);

    Promise.all([
      listen<AgentOutputNotification>(TAURI_EVENTS.agentOutput, (event) => {
        if (mountGenRef.current === gen) applyOutput(event.payload);
      }),
      listen<AgentStateNotification>(TAURI_EVENTS.agentState, (event) => {
        if (mountGenRef.current === gen) applyState(event.payload);
      }),
      listen<AgentExitNotification>(TAURI_EVENTS.agentExit, (event) => {
        if (mountGenRef.current === gen) applyExit(event.payload);
      }),
      listen<AgentErrorNotification>(TAURI_EVENTS.agentError, (event) => {
        if (mountGenRef.current === gen) applyError(event.payload);
      }),
      listen<SidecarStatusEvent>(TAURI_EVENTS.sidecarStatus, (event) => {
        if (mountGenRef.current !== gen) return;

        setSidecar((current) => ({
          ...current,
          available: event.payload.available,
          jobObject: event.payload.jobObject,
          message: event.payload.message ?? null,
        }));

        if (!event.payload.available) {
          rebuildRuntimeOnNextRosterRef.current = true;
          setChannel("unknown");
          setConnectionError(
            event.payload.message ?? "Sidecar 当前不可用",
          );
        }
      }),
    ])
      .then(async (unlisteners) => {
        if (mountGenRef.current !== gen) {
          unlisteners.forEach((unlisten) => unlisten());
          return;
        }

        unlistenRef.current = unlisteners;
        await refreshRoster();
      })
      .catch((error) => {
        if (mountGenRef.current !== gen) return;
        setChannel("unknown");
        setConnectionError(`事件订阅失败：${errMessage(error)}`);
        setRosterLoading(false);
      });

    return () => {
      mountGenRef.current += 1;
      unlistenRef.current?.forEach((unlisten) => unlisten());
      unlistenRef.current = null;
    };
  }, [
    applyError,
    applyExit,
    applyOutput,
    applyState,
    refreshRoster,
    setChannel,
  ]);

  const startAgent = useCallback(
    async (agentId: string, prompt: string, model: string | null) => {
      if (channelPhaseRef.current !== "ready") return;

      const current = runtimeFor(runtimesRef.current, agentId);
      const catalogEntry = agentsRef.current.find(
        (agent) => agent.id === agentId,
      );
      if (
        !catalogEntry?.configured ||
        (current.phase !== "idle" && current.phase !== "finished")
      ) {
        return;
      }

      const gen = mountGenRef.current;
      const runId = nextRunId();
      const token = current.opToken;

      patchRuntime(agentId, {
        phase: "starting",
        runId,
        result: null,
        modelAlias:
          model ?? catalogEntry.defaultModel ?? null,
        resolvedModel: null,
        injectedEnv: null,
        cwd: null,
        lastError: null,
      });
      setOutputs((existing) =>
        existing.filter((line) => line.agentId !== agentId),
      );

      try {
        const ack = await invoke<{
          agentId: string;
          runId: number;
          resolvedModel: string;
          injectedEnv: InjectedEnv;
          cwd: string;
        }>(TAURI_COMMANDS.startAgent, {
          agentId,
          prompt,
          model,
          runId,
        });

        if (mountGenRef.current !== gen) return;
        if (runtimesRef.current[agentId]?.runId !== runId) return;

        patchRuntime(agentId, {
          injectedEnv: ack.injectedEnv,
          cwd: ack.cwd,
          resolvedModel: ack.resolvedModel,
        });

        if (runtimesRef.current[agentId]?.phase === "starting") {
          patchRuntime(agentId, { phase: "running" });
        }
      } catch (error) {
        if (mountGenRef.current !== gen) return;

        const latest = runtimesRef.current[agentId];
        if (latest?.runId !== runId) return;
        if (latest.phase === "finished") return;
        if (token !== latest.opToken) return;

        const kind = errKind(error);
        const message = errMessage(error);

        if (kind === "alreadyRunning") {
          setChannel("unknown");
          setConnectionError(
            "检测到该 Agent 已有实例运行，正在重新同步…",
          );
          await refreshRoster();
          return;
        }

        if (kind === "agentStartFailed") {
          patchRuntime(agentId, {
            phase: "finished",
            result: "failed",
            opToken: latest.opToken + 1,
            lastError: message,
          });
          return;
        }

        patchRuntime(agentId, {
          phase: "idle",
          runId: null,
          resolvedModel: null,
          modelAlias: null,
          injectedEnv: null,
          cwd: null,
          lastError: message,
        });
        setConnectionError(message);
      }
    },
    [nextRunId, patchRuntime, refreshRoster, setChannel],
  );

  const stopAgent = useCallback(
    async (agentId: string) => {
      if (channelPhaseRef.current !== "ready") return;

      const current = runtimesRef.current[agentId];
      if (
        !current ||
        current.phase !== "running" ||
        current.runId === null
      ) {
        return;
      }

      const gen = mountGenRef.current;
      const runId = current.runId;
      const token = current.opToken;
      patchRuntime(agentId, {
        phase: "terminating",
        lastError: null,
      });

      try {
        await invoke(TAURI_COMMANDS.stopAgent, { agentId, runId });
        // 成功只表示请求已受理；终态由 agent-exit 或回滚广播决定。
      } catch (error) {
        if (mountGenRef.current !== gen) return;

        const latest = runtimesRef.current[agentId];
        if (latest?.runId !== runId || latest.opToken !== token) return;

        patchRuntime(agentId, {
          phase: "running",
          lastError: errMessage(error),
        });
      }
    },
    [patchRuntime],
  );

  return {
    channelPhase,
    agents,
    runtimes,
    outputs,
    sidecar,
    configError,
    connectionError,
    rosterLoading,
    refreshRoster,
    startAgent,
    stopAgent,
  };
}
