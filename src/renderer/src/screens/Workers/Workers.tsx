import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Ban,
  Bot,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Play,
  Plug,
  Refresh,
  Search,
  Signal,
  Stop,
  X,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import {
  isTerminalWorkerStatus,
  type AgentHubModelOption,
  type LocalizedText,
  type PublicWorkerProfile,
  type WorkerCatalogCategory,
  type WorkerCatalogEntry,
  type WorkerCatalogResult,
  type WorkerPermissionToken,
  type WorkerMarketStatus,
  type WorkerRunRecord,
  type WorkerRunStatus,
  type WorkerToolResponse,
  type WorkerToolStatus,
} from "../../../../shared/agenthub";

function isOk(
  response: WorkerToolResponse,
): response is Extract<WorkerToolResponse, { ok: true }> {
  return response.ok;
}

/** Catalog text in the active language, tolerant of empty values. */
function localized(
  value: LocalizedText | string | null | undefined,
  zh: boolean,
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return (zh ? value.zh : value.en) || value.zh || value.en || "";
}

/** Both languages at once, so search matches whichever one was typed. */
function searchable(value: LocalizedText | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return `${value.zh} ${value.en}`;
}

const PERMISSION_LABELS = {
  read: { zh: "读取", en: "Read" },
  grep: { zh: "搜索", en: "Grep" },
  find: { zh: "查找", en: "Find" },
  ls: { zh: "列目录", en: "List" },
  "project-root": { zh: "仅项目目录", en: "Project root only" },
  "read-only-sandbox": { zh: "只读沙箱", en: "Read-only sandbox" },
  "no-write": { zh: "禁止写入", en: "No writes" },
  planned: { zh: "待验证", en: "Pending review" },
} satisfies Record<WorkerPermissionToken, LocalizedText>;

function permissionLabel(token: string, zh: boolean): string {
  if (token in PERMISSION_LABELS) {
    return localized(PERMISSION_LABELS[token as WorkerPermissionToken], zh);
  }
  // Unknown token from an older catalog entry: show it instead of dropping it.
  return token;
}

const CATEGORY_LABELS = {
  official: { zh: "官方", en: "Official" },
  "open-source": { zh: "开源", en: "Open source" },
  "vendor-cli": { zh: "厂商 CLI", en: "Vendor CLI" },
  "china-ecosystem": { zh: "国内生态", en: "China ecosystem" },
} satisfies Record<WorkerCatalogCategory, LocalizedText>;

const RUN_STATUS_LABELS = {
  starting: { zh: "启动中", en: "Starting" },
  running: { zh: "运行中", en: "Running" },
  succeeded: { zh: "已成功", en: "Succeeded" },
  failed: { zh: "失败", en: "Failed" },
  cancelled: { zh: "已取消", en: "Cancelled" },
  timed_out: { zh: "已超时", en: "Timed out" },
} satisfies Record<WorkerRunStatus, LocalizedText>;

const RUN_STATUS_TONE: Record<WorkerRunStatus, string> = {
  starting: "active",
  running: "active",
  succeeded: "ok",
  failed: "bad",
  timed_out: "bad",
  cancelled: "idle",
};

interface PendingCatalogAction {
  id: string;
  action: "install" | "remove";
}

function formatTime(value: number, locale: string): string {
  try {
    return new Date(value).toLocaleString(locale, { hour12: false });
  } catch {
    return new Date(value).toISOString();
  }
}

function formatDuration(ms: number, zh: boolean): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}${zh ? " 秒" : "s"}`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return zh ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
}

function byRank(a: WorkerCatalogEntry, b: WorkerCatalogEntry): number {
  const rankA = typeof a.rank === "number" ? a.rank : Number.POSITIVE_INFINITY;
  const rankB = typeof b.rank === "number" ? b.rank : Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return a.name.localeCompare(b.name);
}
/**
 * Human-readable name for where the market list came from, so the screen never
 * implies a stale list is live: a fetched document, the last one kept on disk,
 * or the table this build shipped with.
 */
function originLabel(origin: WorkerMarketStatus["origin"], en = false): string {
  switch (origin) {
    case "remote":
      return en ? "fetched list" : "刚获取的清单";
    case "cache":
      return en ? "saved copy" : "上次保存的清单";
    default:
      return en ? "built-in list" : "内置清单";
  }
}

/** Sentinel for "this agent names a model that Hermes does not have". */
const CUSTOM_MODEL_CHOICE = "__custom__";

interface ModelPickerProps {
  workerId: string;
  agentName: string;
  /** Model currently pinned by the main process, or null for the CLI default. */
  pinned: string | null;
  options: AgentHubModelOption[];
  zh: boolean;
  busy: boolean;
  onApply: (model: string | null) => void;
}

/**
 * One agent's model setting. The dropdown is the model library Hermes already
 * has; "custom" is for a model this agent alone should use, which that CLI then
 * resolves with its own sign-in and keys. Nothing here adds a provider or key.
 */
function ModelPicker({
  workerId,
  agentName,
  pinned,
  options,
  zh,
  busy,
  onApply,
}: ModelPickerProps): React.JSX.Element {
  const txt = (zhText: string, enText: string): string =>
    zh ? zhText : enText;
  const [choice, setChoice] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const base = !pinned
    ? ""
    : options.some((option) => option.model === pinned || option.id === pinned)
      ? pinned
      : CUSTOM_MODEL_CHOICE;
  const shownChoice = choice ?? base;
  const showCustom = shownChoice === CUSTOM_MODEL_CHOICE;
  const trimmed = custom.trim();
  const target = showCustom ? trimmed : shownChoice || null;
  const dirty = target !== (pinned ?? null);

  const grouped = useMemo(() => {
    const map = new Map<string, AgentHubModelOption[]>();
    for (const option of options) {
      const list = map.get(option.provider) ?? [];
      list.push(option);
      map.set(option.provider, list);
    }
    return [...map.entries()];
  }, [options]);

  const selectId = `workers-model-${workerId}`;

  return (
    <div className="workers-model">
      <div className="workers-model-head">
        <label className="workers-model-label" htmlFor={selectId}>
          {txt("模型", "Model")}
        </label>
        <span className="workers-model-current">
          {pinned ?? txt("跟随 CLI 默认", "CLI default")}
        </span>
      </div>
      <select
        id={selectId}
        className="workers-model-select"
        value={shownChoice}
        disabled={busy}
        onChange={(event) => setChoice(event.target.value)}
        aria-label={txt(
          `为 ${agentName} 选择模型`,
          `Choose a model for ${agentName}`,
        )}
      >
        <option value="">{txt("跟随 CLI 默认", "Use the CLI default")}</option>
        {grouped.map(([provider, list]) => (
          <optgroup key={provider} label={provider}>
            {list.map((option) => (
              <option key={option.id} value={option.model}>
                {option.label === option.model
                  ? option.model
                  : `${option.label} · ${option.model}`}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_MODEL_CHOICE}>
          {txt("自定义模型 ID…", "Custom model id…")}
        </option>
      </select>
      {showCustom ? (
        <input
          className="workers-model-input"
          value={custom}
          disabled={busy}
          placeholder="provider/model-id"
          spellCheck={false}
          onChange={(event) => setCustom(event.target.value)}
          aria-label={txt("自定义模型 ID", "Custom model id")}
        />
      ) : null}
      <div className="workers-model-actions">
        <button
          type="button"
          className="workers-model-save"
          disabled={!dirty || busy || (showCustom && trimmed.length === 0)}
          onClick={() => onApply(target)}
        >
          {busy ? (
            <OrbLoader state="composing" size={13} />
          ) : (
            <Check size={13} />
          )}
          {txt("保存", "Save")}
        </button>
        {pinned ? (
          <button
            type="button"
            className="workers-model-clear"
            disabled={busy}
            onClick={() => {
              setChoice("");
              onApply(null);
            }}
          >
            {txt("清除", "Clear")}
          </button>
        ) : null}
      </div>
      <p className="workers-model-hint">
        {txt(
          "默认从 Hermes 已经配好的模型里选；选“自定义”时，这个模型由该 CLI 自己的登录和密钥解析。",
          "Pick from the models Hermes already configured, or name one for this agent alone — a custom id is resolved by that CLI's own sign-in and keys.",
        )}
      </p>
    </div>
  );
}

function Workers(): React.JSX.Element {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const txt = (zhText: string, enText: string): string =>
    zh ? zhText : enText;

  const [status, setStatus] = useState<WorkerToolStatus | null>(null);
  const [catalog, setCatalog] = useState<WorkerCatalogEntry[]>([]);
  const [workers, setWorkers] = useState<PublicWorkerProfile[]>([]);
  const [runs, setRuns] = useState<WorkerRunRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pollError, setPollError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalogBusy, setCatalogBusy] = useState<PendingCatalogAction | null>(
    null,
  );
  const [startingWorkerId, setStartingWorkerId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<AgentHubModelOption[]>([]);
  const [modelBusyId, setModelBusyId] = useState<string | null>(null);
  // Where the market candidate list came from (fetched / cached / shipped) and
  // whether a fetch is running. The list itself is unreadable without knowing
  // how fresh it is.
  const [marketStatus, setMarketStatus] = useState<WorkerMarketStatus | null>(
    null,
  );
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const inFlight = useRef(false);

  const error = pageError || pollError;

  const refresh = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      const silent = options?.silent === true;
      if (silent && inFlight.current) return;
      inFlight.current = true;
      if (!silent) setRefreshing(true);
      try {
        const [toolStatus, catalogResult, listed, market] = await Promise.all([
          window.hermesAPI.agenthubToolStatus(),
          window.hermesAPI.agenthubCatalogList(),
          window.hermesAPI.agenthubDispatch("worker.list", {}),
          window.hermesAPI.agenthubMarketStatus(),
        ]);
        setStatus(toolStatus);
        setMarketStatus(market ?? null);
        setCatalog(
          Array.isArray(catalogResult?.entries) ? catalogResult.entries : [],
        );
        if (!isOk(listed)) {
          if (silent) setPollError(listed.error);
          else setPageError(listed.error);
          return;
        }
        const result = listed.result as {
          workers?: PublicWorkerProfile[];
          runs?: WorkerRunRecord[];
        } | null;
        setWorkers(
          (result?.workers ?? []).filter(
            (worker) => worker.installed && worker.enabled,
          ),
        );
        setRuns(
          [...(result?.runs ?? [])].sort(
            (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
          ),
        );
        setPollError("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (silent) setPollError(message);
        else setPageError(message);
      } finally {
        inFlight.current = false;
        if (!silent) setRefreshing(false);
        setLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
    const stop = window.hermesAPI.onAgenthubWorkerChanged(() => {
      void refresh({ silent: true });
    });
    const id = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);
    return () => {
      stop();
      window.clearInterval(id);
    };
  }, [refresh]);

  /**
   * Fetch a fresh market catalog. This is the only action that reaches the
   * network on this screen, so it stays explicit and reports its outcome —
   * a failed fetch keeps the previous list rather than emptying it.
   */
  const refreshMarket = async (): Promise<void> => {
    setMarketRefreshing(true);
    setNotice("");
    try {
      const result = await window.hermesAPI.agenthubMarketRefresh();
      setMarketStatus(result ?? null);
      if (Array.isArray(result?.catalog?.entries)) {
        setCatalog(result.catalog.entries);
      }
      if (result?.error) {
        setNotice(
          txt(
            `刷新清单失败（${result.error}），仍在用${originLabel(result.origin)}。`,
            `Could not refresh the list (${result.error}); still using the ${originLabel(result.origin, true)}.`,
          ),
        );
      } else {
        setNotice(
          txt(
            `清单已更新，共 ${result?.count ?? 0} 个智能体。`,
            `List updated — ${result?.count ?? 0} agents.`,
          ),
        );
      }
    } catch (err) {
      setNotice(
        txt(
          `刷新清单失败：${err instanceof Error ? err.message : String(err)}`,
          `Could not refresh the list: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } finally {
      setMarketRefreshing(false);
    }
  };

  const loadModels = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.agenthubCatalogModels();
      setModelOptions(Array.isArray(list) ? list : []);
    } catch {
      // The model library is unavailable until Hermes is configured; the
      // dropdown then offers only the CLI default plus a custom id.
    }
  }, []);

  useEffect(() => {
    void loadModels();
    const onFocus = (): void => void loadModels();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadModels]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!copiedId) return;
    const id = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(id);
  }, [copiedId]);

  const changeSelection = async (
    entry: WorkerCatalogEntry,
    action: "install" | "remove",
  ): Promise<void> => {
    setCatalogBusy({ id: entry.id, action });
    setPageError("");
    setNotice("");
    try {
      const result: WorkerCatalogResult =
        action === "install"
          ? await window.hermesAPI.agenthubCatalogInstall(entry.id)
          : await window.hermesAPI.agenthubCatalogRemove(entry.id);
      if (Array.isArray(result?.entries)) setCatalog(result.entries);
      await refresh();
      setNotice(
        action === "install"
          ? txt(
              `已把 ${entry.name} 接入 AgentHub。`,
              `${entry.name} is now connected to AgentHub.`,
            )
          : txt(
              `已把 ${entry.name} 从 AgentHub 移除。`,
              `${entry.name} was removed from AgentHub.`,
            ),
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogBusy(null);
    }
  };

  const applyModel = async (
    entry: WorkerCatalogEntry,
    model: string | null,
  ): Promise<void> => {
    setModelBusyId(entry.id);
    setPageError("");
    setNotice("");
    try {
      const result = await window.hermesAPI.agenthubCatalogSetModel(
        entry.id,
        model,
      );
      if (Array.isArray(result?.entries)) setCatalog(result.entries);
      await loadModels();
      setNotice(
        model
          ? txt(
              `已让 ${entry.name} 使用 ${model}。`,
              `${entry.name} now runs on ${model}.`,
            )
          : txt(
              `已让 ${entry.name} 回到它自己的默认模型。`,
              `${entry.name} falls back to its own default model.`,
            ),
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelBusyId(null);
    }
  };

  const runWorker = async (worker: PublicWorkerProfile): Promise<void> => {
    setStartingWorkerId(worker.id);
    setPageError("");
    setNotice("");
    const prompt = zh
      ? "请检查当前工作区状态，只读查看与本任务相关的文件，并用简短中文总结你观察到的内容。不要修改文件。"
      : "Inspect the current workspace in read-only mode and briefly summarize the relevant files. Do not modify files.";
    try {
      const started = await window.hermesAPI.agenthubDispatch("worker.start", {
        workerId: worker.id,
        prompt,
      });
      if (!isOk(started)) {
        setPageError(started.error);
        return;
      }
      await refresh({ silent: true });
      setNotice(
        txt(
          `已让 ${worker.name} 开始一次只读检查，完成后记录会出现在卡片里。`,
          `${worker.name} started a read-only inspection; the record appears in its card when it finishes.`,
        ),
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingWorkerId(null);
    }
  };

  const cancelRun = async (run: WorkerRunRecord): Promise<void> => {
    setCancellingRunId(run.runId);
    setPageError("");
    try {
      const result = await window.hermesAPI.agenthubDispatch("worker.cancel", {
        runId: run.runId,
      });
      if (!isOk(result)) {
        setPageError(result.error);
        return;
      }
      setNotice(txt("已请求取消这次运行。", "Cancellation requested."));
      await refresh({ silent: true });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancellingRunId(null);
    }
  };

  const copyInstallHint = async (entry: WorkerCatalogEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.installHint);
      setCopiedId(entry.id);
    } catch {
      setPageError(
        txt(
          "复制失败，请手动选中命令后复制。",
          "Copy failed — select the command text and copy it manually.",
        ),
      );
    }
  };

  const openDocs = (entry: WorkerCatalogEntry): void => {
    setPageError("");
    void window.hermesAPI.openExternal(entry.docsUrl);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (entry: WorkerCatalogEntry): boolean => {
      if (!normalizedQuery) return true;
      const haystack =
        `${entry.name ?? ""} ${entry.vendor ?? ""} ${searchable(entry.role)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const supportedEntries = useMemo(
    () =>
      catalog.filter(
        (entry) => entry.runner === "available" && matchesQuery(entry),
      ),
    [catalog, matchesQuery],
  );
  const marketEntries = useMemo(
    () =>
      catalog
        .filter((entry) => entry.runner !== "available")
        .sort(byRank)
        .filter(matchesQuery),
    [catalog, matchesQuery],
  );

  const anyActiveRun = runs.some((run) => !isTerminalWorkerStatus(run.status));
  const listedWorkerIds = new Set(workers.map((worker) => worker.id));
  const orphanRuns = runs.filter((run) => !listedWorkerIds.has(run.workerId));

  const renderRun = (
    run: WorkerRunRecord,
    showWorkerName: boolean,
  ): React.JSX.Element => {
    const active = !isTerminalWorkerStatus(run.status);
    const cancelling = cancellingRunId === run.runId;
    const tone = RUN_STATUS_TONE[run.status] ?? "idle";
    const duration =
      run.startedAt && run.endedAt
        ? formatDuration(run.endedAt - run.startedAt, zh)
        : "";
    const workerName =
      workers.find((worker) => worker.id === run.workerId)?.name ??
      run.workerId;
    return (
      <div className="workers-run">
        <div className="workers-run-head">
          <span className={`workers-run-status workers-run-status-${tone}`}>
            {active ? <OrbLoader state="composing" size={14} /> : null}
            {localized(RUN_STATUS_LABELS[run.status], zh)}
          </span>
          <span className="workers-run-time">
            {showWorkerName ? (
              <span className="workers-run-worker">{workerName} · </span>
            ) : null}
            <Clock size={12} aria-hidden="true" />
            {formatTime(run.createdAt, locale)}
            {duration ? ` · ${txt("用时", "took")} ${duration}` : ""}
            {run.attempt > 1
              ? ` · ${txt(`第 ${run.attempt} 次尝试`, `attempt ${run.attempt}`)}`
              : ""}
          </span>
        </div>
        {run.summary ? (
          <p className="workers-run-summary">{run.summary}</p>
        ) : null}
        {run.promptPreview && run.promptPreview !== run.summary ? (
          <p className="workers-run-prompt">
            <span className="workers-run-label">{txt("任务", "Task")}</span>
            {run.promptPreview}
          </p>
        ) : null}
        {run.output ? (
          <pre
            className="workers-output"
            tabIndex={0}
            aria-label={txt("运行输出", "Run output")}
          >
            {run.output}
          </pre>
        ) : null}
        {run.error ? (
          <p className="workers-run-error">
            <Alert size={13} aria-hidden="true" />
            <span>{run.error}</span>
          </p>
        ) : null}
        {active ? (
          <div className="workers-run-actions">
            <button
              type="button"
              className="workers-btn workers-btn-danger"
              disabled={cancelling}
              onClick={() => void cancelRun(run)}
              aria-label={txt(
                `取消 ${workerName} 的运行`,
                `Cancel the ${workerName} run`,
              )}
              title={txt("取消这次运行", "Cancel this run")}
            >
              {cancelling ? (
                <OrbLoader state="composing" size={14} />
              ) : (
                <Stop size={13} aria-hidden="true" />
              )}
              {txt("取消", "Cancel")}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderCatalogCard = (
    entry: WorkerCatalogEntry,
    variant: "supported" | "market",
  ): React.JSX.Element => {
    const planned = entry.runner !== "available";
    const busy = catalogBusy?.id === entry.id;
    const busyAction = busy ? catalogBusy.action : null;
    const role = localized(entry.role, zh);
    const description = localized(entry.description, zh);
    const note = localized(entry.note, zh);
    const plannedReason =
      (planned ? note : "") ||
      (planned
        ? txt(
            "安全 Runner 尚未实现，先看安装说明，把 CLI 装到本机即可。",
            "A safe AgentHub runner is not implemented yet — read the install guide and install the CLI locally.",
          )
        : "");
    const category = CATEGORY_LABELS[entry.category];
    const statusTone = entry.enabled
      ? "enabled"
      : entry.detected
        ? "detected"
        : "missing";
    const statusLabel = entry.enabled
      ? txt("可运行", "Runnable")
      : entry.detected
        ? txt("已探测未接入", "Detected, not connected")
        : txt("未探测", "Not detected");
    const connectTitle = planned
      ? plannedReason
      : !entry.detected
        ? txt(
            "需要先在本机安装这个 CLI，安装命令见卡片。",
            "Install this CLI on this machine first — see the install command above.",
          )
        : txt("接入 AgentHub 后即可运行", "Connect it to AgentHub to run it");
    return (
      <article
        key={entry.id}
        className={`workers-card${entry.installed ? " workers-card-selected" : ""}`}
      >
        <div className="workers-card-head">
          <div className="workers-card-badges">
            {typeof entry.rank === "number" ? (
              <span
                className="workers-rank"
                title={txt(
                  `市场排名第 ${entry.rank}`,
                  `Market rank #${entry.rank}`,
                )}
              >
                #{entry.rank}
              </span>
            ) : null}
            {entry.builtIn ? (
              <span className="workers-badge workers-badge-accent">
                {txt("AgentHub 自带", "Built into AgentHub")}
              </span>
            ) : null}
            {category ? (
              <span className="workers-badge workers-badge-plain">
                {localized(category, zh)}
              </span>
            ) : null}
          </div>
          <span className={`workers-status workers-status-${statusTone}`}>
            {statusLabel}
          </span>
        </div>

        <div className="workers-card-main">
          <h3 className="workers-card-name">{entry.name}</h3>
          <p className="workers-card-sub">
            {[entry.vendor, role].filter(Boolean).join(" · ")}
          </p>
        </div>

        {description ? (
          <p className="workers-card-desc">{description}</p>
        ) : null}

        {variant === "supported" ? (
          <dl className="workers-meta-grid">
            <div className="workers-meta-item">
              <dt className="workers-meta-label">
                {txt("可执行文件", "Executable")}
              </dt>
              <dd className="workers-meta-value">
                {entry.executablePath ?? txt("未找到", "Not found")}
              </dd>
            </div>
            <div className="workers-meta-item">
              <dt className="workers-meta-label">{txt("版本", "Version")}</dt>
              <dd className="workers-meta-value">
                {entry.version ?? txt("未知", "Unknown")}
              </dd>
            </div>
            <div className="workers-meta-item">
              <dt className="workers-meta-label">
                {txt("接入状态", "AgentHub")}
              </dt>
              <dd className="workers-meta-value">
                {entry.installed
                  ? txt("已接入", "Connected")
                  : txt("未接入", "Not connected")}
              </dd>
            </div>
          </dl>
        ) : null}

        {Array.isArray(entry.permissions) && entry.permissions.length > 0 ? (
          <div className="workers-perms">
            <span className="workers-perms-label">
              {txt("权限", "Permissions")}
            </span>
            <ul className="workers-perms-list">
              {entry.permissions.map((token) => (
                <li
                  key={token}
                  className={`workers-perm${token === "planned" ? " workers-perm-planned" : ""}`}
                >
                  {permissionLabel(token, zh)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {entry.supportsModelSelection ? (
          <ModelPicker
            key={`${entry.id}-${entry.model ?? "default"}`}
            workerId={entry.id}
            agentName={entry.name}
            pinned={entry.model}
            options={modelOptions}
            zh={zh}
            busy={modelBusyId === entry.id}
            onApply={(model) => void applyModel(entry, model)}
          />
        ) : null}

        {entry.installHint ? (
          <div className="workers-install">
            <span className="workers-install-label">
              {txt("安装命令", "Install command")}
            </span>
            <div className="workers-install-row">
              <code className="workers-install-code">{entry.installHint}</code>
              <button
                type="button"
                className="workers-icon-btn workers-icon-btn-sm"
                onClick={() => void copyInstallHint(entry)}
                aria-label={
                  copiedId === entry.id
                    ? txt("安装命令已复制", "Install command copied")
                    : txt("复制安装命令", "Copy install command")
                }
                title={txt("复制安装命令", "Copy install command")}
              >
                {copiedId === entry.id ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        ) : null}

        {plannedReason ? (
          <p className="workers-note workers-note-blocked">
            <Ban size={14} aria-hidden="true" />
            <span>{plannedReason}</span>
          </p>
        ) : note ? (
          <p className="workers-note">
            <Alert size={14} aria-hidden="true" />
            <span>{note}</span>
          </p>
        ) : null}

        <div className="workers-card-actions">
          <button
            type="button"
            className="workers-btn"
            onClick={() => openDocs(entry)}
            aria-label={txt(
              `查看 ${entry.name} 的安装说明`,
              `Open the ${entry.name} install guide`,
            )}
            title={txt("在浏览器打开官方文档", "Open the official docs")}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {txt("安装说明", "Install guide")}
          </button>
          {planned ? (
            <button
              type="button"
              className="workers-btn workers-btn-primary"
              disabled
              aria-label={txt(
                `${entry.name} 暂时无法接入`,
                `${entry.name} cannot be connected yet`,
              )}
              title={connectTitle}
            >
              <Ban size={14} aria-hidden="true" />
              {txt("接入（待实现）", "Connect (planned)")}
            </button>
          ) : entry.installed ? (
            <button
              type="button"
              className="workers-btn workers-btn-danger"
              disabled={busy}
              onClick={() => void changeSelection(entry, "remove")}
              aria-label={txt(
                `从 AgentHub 移除 ${entry.name}`,
                `Remove ${entry.name} from AgentHub`,
              )}
              title={txt("从 AgentHub 移除", "Remove from AgentHub")}
            >
              {busy && busyAction === "remove" ? (
                <OrbLoader state="composing" size={14} />
              ) : (
                <X size={14} aria-hidden="true" />
              )}
              {txt("移除", "Remove")}
            </button>
          ) : (
            <button
              type="button"
              className="workers-btn workers-btn-primary"
              disabled={!entry.installable || busy}
              onClick={() => void changeSelection(entry, "install")}
              aria-label={txt(
                `把 ${entry.name} 安装到 AgentHub`,
                `Connect ${entry.name} to AgentHub`,
              )}
              title={connectTitle}
            >
              {busy && busyAction === "install" ? (
                <OrbLoader state="composing" size={14} />
              ) : (
                <Plug size={14} aria-hidden="true" />
              )}
              {txt("安装到 AgentHub", "Connect to AgentHub")}
            </button>
          )}
        </div>
      </article>
    );
  };

  const supportedTitle = txt("AgentHub 已支持", "Supported by AgentHub");
  const marketTitle = txt("市面主流 CLI", "Market CLIs");
  const connectedTitle = txt("已接入且可运行", "Connected and runnable");
  const serviceTitle = txt("本机服务状态", "Local service status");

  const searchActive = normalizedQuery.length > 0;
  const noSearchResults =
    searchActive && supportedEntries.length === 0 && marketEntries.length === 0;
  const catalogEmpty = loaded && catalog.length === 0 && !error;

  return (
    <div className="schedules-container workers-page">
      <header className="schedules-header workers-header">
        <div className="workers-header-text">
          <h1 className="schedules-title">{t("navigation.workers")}</h1>
          <p className="schedules-subtitle">
            {txt(
              "这里列出你本机能用的智能体（Worker）：AgentHub 已支持的直接安装运行，市面主流 CLI 先看安装说明。",
              "Every agent (Worker) this machine can use: the ones AgentHub supports can be connected and run right away, the market CLIs come with install instructions first.",
            )}
          </p>
          {marketStatus ? (
            <p className="workers-market-origin">
              <Globe size={12} aria-hidden="true" />
              <span>
                {txt(
                  `候选清单来自${originLabel(marketStatus.origin)}，共 ${marketStatus.count} 个`,
                  `Candidate list: ${originLabel(marketStatus.origin, true)}, ${marketStatus.count} agents`,
                )}
                {marketStatus.fetchedAt
                  ? txt(
                      `（${formatTime(marketStatus.fetchedAt, locale)}）`,
                      ` (${formatTime(marketStatus.fetchedAt, locale)})`,
                    )
                  : ""}
              </span>
              {marketStatus.error ? (
                <span className="workers-market-origin-warn">
                  {txt("上次刷新失败", "last refresh failed")}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="schedules-header-actions">
          <button
            type="button"
            className="workers-icon-btn"
            onClick={() => void refreshMarket()}
            disabled={marketRefreshing}
            aria-busy={marketRefreshing}
            aria-label={txt("刷新候选清单", "Refresh the candidate list")}
            title={txt(
              "从网络重新获取候选清单（不会安装任何东西）",
              "Re-fetch the candidate list from the network (installs nothing)",
            )}
          >
            {marketRefreshing ? (
              <OrbLoader state="composing" size={14} />
            ) : (
              <Signal size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="workers-icon-btn"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-busy={refreshing}
            aria-label={txt("刷新智能体列表", "Refresh the agent list")}
            title={txt("刷新", "Refresh")}
          >
            {refreshing ? (
              <OrbLoader state="composing" size={14} />
            ) : (
              <Refresh size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {pageError || pollError ? (
        <div className="workers-banner workers-banner-error" role="alert">
          <Alert size={16} aria-hidden="true" />
          <span className="workers-banner-text">{error}</span>
          <button
            type="button"
            className="workers-icon-btn workers-icon-btn-sm"
            onClick={() => {
              setPageError("");
              setPollError("");
            }}
            aria-label={txt("关闭错误提示", "Dismiss the error")}
            title={txt("关闭", "Dismiss")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="workers-banner workers-banner-notice" role="status">
          <Check size={16} aria-hidden="true" />
          <span className="workers-banner-text">{notice}</span>
        </div>
      ) : null}

      {!loaded ? (
        <div className="workers-loading">
          <OrbLoader state="composing" size={28} />
          <span className="workers-loading-text">
            {txt("正在读取本机智能体…", "Reading local agents…")}
          </span>
        </div>
      ) : null}

      {loaded && catalog.length > 0 ? (
        <div className="workers-search" role="search">
          <Search
            size={16}
            className="workers-search-icon"
            aria-hidden="true"
          />
          <input
            type="search"
            className="workers-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={txt(
              "按名称、厂商或角色搜索",
              "Search by name, vendor or role",
            )}
            aria-label={txt("搜索智能体", "Search agents")}
            spellCheck={false}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="workers-icon-btn workers-icon-btn-sm workers-search-clear"
              onClick={() => setQuery("")}
              aria-label={txt("清空搜索", "Clear the search")}
              title={txt("清空", "Clear")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {catalogEmpty ? (
        <div className="workers-empty">
          <Bot size={22} aria-hidden="true" />
          <p className="workers-empty-title">
            {txt("目录里还没有智能体", "The catalog is empty")}
          </p>
          <p className="workers-empty-hint">
            {txt(
              "刷新一次看看；如果还是空的，说明 AgentHub 还没读到本机目录。",
              "Try refreshing. If it stays empty, AgentHub could not read the local catalog.",
            )}
          </p>
          <button
            type="button"
            className="workers-btn"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <OrbLoader state="composing" size={14} />
            ) : (
              <Refresh size={14} aria-hidden="true" />
            )}
            {txt("刷新", "Refresh")}
          </button>
        </div>
      ) : null}

      {noSearchResults ? (
        <div className="workers-empty">
          <Search size={22} aria-hidden="true" />
          <p className="workers-empty-title">
            {txt("没有匹配的智能体", "No agents match")}
          </p>
          <p className="workers-empty-hint">
            {txt(
              `没有找到和「${query.trim()}」匹配的智能体，试试更短的关键词，或清空搜索。`,
              `Nothing matches “${query.trim()}”. Try a shorter keyword or clear the search.`,
            )}
          </p>
          <button
            type="button"
            className="workers-btn"
            onClick={() => setQuery("")}
          >
            <X size={14} aria-hidden="true" />
            {txt("清空搜索", "Clear search")}
          </button>
        </div>
      ) : null}

      {supportedEntries.length > 0 ? (
        <section className="workers-section" aria-label={supportedTitle}>
          <div className="workers-section-head">
            <h2 className="workers-section-title">
              <Bot size={16} aria-hidden="true" />
              <span>{supportedTitle}</span>
            </h2>
            <span className="workers-section-count">
              {txt(
                `${supportedEntries.length} 个`,
                `${supportedEntries.length}`,
              )}
            </span>
          </div>
          <p className="workers-section-desc">
            {txt(
              "这些智能体的只读运行方式已经过 AgentHub 验证，可以直接接入使用。",
              "AgentHub ships a reviewed read-only runner for these agents — connect them and run.",
            )}
          </p>
          <div className="workers-cards">
            {supportedEntries.map((entry) =>
              renderCatalogCard(entry, "supported"),
            )}
          </div>
        </section>
      ) : null}

      {marketEntries.length > 0 ? (
        <section className="workers-section" aria-label={marketTitle}>
          <div className="workers-section-head">
            <h2 className="workers-section-title">
              <Globe size={16} aria-hidden="true" />
              <span>{marketTitle}</span>
            </h2>
            <span className="workers-section-count">
              {txt(`${marketEntries.length} 个`, `${marketEntries.length}`)}
            </span>
          </div>
          <p className="workers-section-desc">
            {txt(
              "按使用人数排序。它们还不能接入 AgentHub（安全运行方式尚未实现），先看安装命令和官方说明。",
              "Ordered by usage. They cannot be connected yet — a safe runner is still missing — so read the install command and the official guide first.",
            )}
          </p>
          <div className="workers-cards">
            {marketEntries.map((entry) => renderCatalogCard(entry, "market"))}
          </div>
        </section>
      ) : null}

      <section className="workers-section" aria-label={connectedTitle}>
        <div className="workers-section-head">
          <h2 className="workers-section-title">
            <Plug size={16} aria-hidden="true" />
            <span>{connectedTitle}</span>
          </h2>
          <span className="workers-section-count">
            {txt(`${workers.length} 个`, `${workers.length}`)}
          </span>
        </div>
        <p className="workers-section-desc">
          {txt(
            "已接入的智能体会在这里出现，点「运行」让它只读检查一次当前项目。",
            "Connected agents appear here. Select Run to let one inspect the current project read-only.",
          )}
        </p>
        {workers.length === 0 ? (
          <div className="workers-empty">
            <Plug size={22} aria-hidden="true" />
            <p className="workers-empty-title">
              {txt("还没有可运行的智能体", "No runnable agent yet")}
            </p>
            <p className="workers-empty-hint">
              {txt(
                "先在上面「AgentHub 已支持」里点「安装到 AgentHub」；需要本机已装好对应的 CLI，且状态显示「可运行」。",
                "Connect one under “Supported by AgentHub” above. The CLI must be installed locally and its status must read “Runnable”.",
              )}
            </p>
          </div>
        ) : (
          <div className="workers-cards">
            {workers.map((worker) => {
              const workerRuns = runs.filter(
                (run) => run.workerId === worker.id,
              );
              const starting = startingWorkerId === worker.id;
              const runDisabled =
                starting || Boolean(startingWorkerId) || anyActiveRun;
              return (
                <article
                  key={worker.id}
                  className="workers-card workers-card-worker"
                >
                  <div className="workers-card-head">
                    <div className="workers-card-main">
                      <h3 className="workers-card-name">{worker.name}</h3>
                      <p className="workers-card-sub">{worker.id}</p>
                    </div>
                    <button
                      type="button"
                      className="workers-btn workers-btn-primary"
                      disabled={runDisabled}
                      onClick={() => void runWorker(worker)}
                      aria-label={txt(
                        `运行 ${worker.name}`,
                        `Run ${worker.name}`,
                      )}
                      title={
                        runDisabled
                          ? txt(
                              "已有任务在运行，请等它结束或先取消。",
                              "A task is already running — wait for it or cancel it first.",
                            )
                          : txt(
                              "开始一次只读检查",
                              "Start a read-only inspection",
                            )
                      }
                    >
                      {starting ? (
                        <OrbLoader state="composing" size={14} />
                      ) : (
                        <Play size={14} aria-hidden="true" />
                      )}
                      {anyActiveRun
                        ? txt("运行中", "Running")
                        : txt("运行", "Run")}
                    </button>
                  </div>

                  <dl className="workers-meta-grid">
                    <div className="workers-meta-item">
                      <dt className="workers-meta-label">
                        {txt("类型", "Kind")}
                      </dt>
                      <dd className="workers-meta-value">
                        {worker.kind === "echo"
                          ? txt("回显测试", "Echo test")
                          : txt("本地 CLI", "Local CLI")}
                      </dd>
                    </div>
                    <div className="workers-meta-item">
                      <dt className="workers-meta-label">
                        {txt("最长运行时间", "Timeout")}
                      </dt>
                      <dd className="workers-meta-value">
                        {Math.round((worker.timeoutMs ?? 0) / 60000)
                          ? txt(
                              `${Math.round((worker.timeoutMs ?? 0) / 60000)} 分钟`,
                              `${Math.round((worker.timeoutMs ?? 0) / 60000)} min`,
                            )
                          : txt("未设置", "Not set")}
                      </dd>
                    </div>
                    <div className="workers-meta-item">
                      <dt className="workers-meta-label">
                        {txt("同时运行上限", "Max concurrent")}
                      </dt>
                      <dd className="workers-meta-value">
                        {worker.maxConcurrent ?? "—"}
                      </dd>
                    </div>
                  </dl>

                  <p className="workers-hint">
                    {txt(
                      "每次运行只读检查当前项目，不会修改文件。",
                      "Each run inspects the current project read-only and never modifies files.",
                    )}
                  </p>

                  <div className="workers-runs">
                    <div className="workers-runs-head">
                      <span className="workers-runs-title">
                        {txt("运行记录", "Run history")}
                      </span>
                      <span className="workers-runs-count">
                        {workerRuns.length}
                      </span>
                    </div>
                    {workerRuns.length === 0 ? (
                      <p className="workers-hint">
                        {txt(
                          "还没有运行记录。点「运行」开始一次只读检查。",
                          "No runs yet. Select Run to start a read-only inspection.",
                        )}
                      </p>
                    ) : (
                      <ul className="workers-runs-list">
                        {workerRuns.map((run) => (
                          <li key={run.runId}>{renderRun(run, false)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {orphanRuns.length > 0 ? (
        <section
          className="workers-section"
          aria-label={txt("其他运行记录", "Other run history")}
        >
          <div className="workers-section-head">
            <h2 className="workers-section-title">
              <Clock size={16} aria-hidden="true" />
              <span>{txt("其他运行记录", "Other run history")}</span>
            </h2>
            <span className="workers-section-count">
              {txt(`${orphanRuns.length} 条`, `${orphanRuns.length}`)}
            </span>
          </div>
          <p className="workers-section-desc">
            {txt(
              "这些记录来自当前不在「已接入且可运行」列表里的智能体，保留下来方便你查看结果。",
              "These records come from agents that are not in “Connected and runnable” right now; they are kept so you can still read the outcome.",
            )}
          </p>
          <ul className="workers-runs-list">
            {orphanRuns.map((run) => (
              <li key={run.runId}>{renderRun(run, true)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="workers-section workers-section-service"
        aria-label={serviceTitle}
      >
        <div className="workers-section-head">
          <h2 className="workers-section-title">
            <Signal size={16} aria-hidden="true" />
            <span>{serviceTitle}</span>
          </h2>
          <span
            className={`workers-status workers-status-${status?.listening ? "enabled" : "missing"}`}
          >
            {status?.listening
              ? txt("监听中", "Listening")
              : txt("未监听", "Not listening")}
          </span>
        </div>
        <p className="workers-section-desc">
          {txt(
            "Hermes 通过这个本机地址调用上面的智能体；显示「未监听」时，智能体暂时无法被调用。",
            "Hermes calls the agents above through this local address. While it reads “Not listening”, they cannot be called.",
          )}
        </p>
        <p className="workers-service-url" title={status?.url ?? undefined}>
          {status?.url ?? txt("暂无地址", "No address yet")}
        </p>
        <p className="workers-hint">
          {status?.tokenConfigured
            ? txt("访问令牌已配置", "Access token configured")
            : txt("访问令牌未配置", "Access token not configured")}
        </p>
      </section>
    </div>
  );
}

export default Workers;
