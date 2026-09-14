import { app } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  sanitizeWorkerModel,
  type AgentHubModelOption,
  type LocalizedText,
  type WorkerCatalogEntry,
  type WorkerCatalogResult,
  type WorkerPermissionToken,
} from "../../shared/agenthub";
import { safeWriteFile } from "../utils";
import {
  clearCliProbeCache,
  probeCliCommands,
  readCliVersionCached,
} from "./profiles";
import { WORKER_MARKET, type WorkerMarketEntry } from "./market";
import { resolveWindowsShimEntry } from "./runner";
import { listModels } from "../models";

const STORE_VERSION = 1;
const STORE_FILENAME = "agenthub-catalog.v1.json";

interface CatalogState {
  version: number;
  installedIds: string[];
  /** Per-agent model chosen from the Hermes library; missing means CLI default. */
  agentModels?: Record<string, string>;
}

/**
 * AgentHub's own reviewed Runner, listed ahead of the market candidates. Pi is
 * the only CLI whose read-only argument set has been verified on this machine.
 */
const PI_RUNNER_ENTRY = {
  id: "pi",
  rank: null,
  builtIn: true,
  name: "Pi",
  vendor: "Pi",
  category: "official",
  role: {
    zh: "只读工作区智能体",
    en: "Read-only workspace agent",
  },
  description: {
    zh: "AgentHub 已支持：固定只读工具白名单、离线模式，工作目录由主进程限制在项目根目录。",
    en: "Supported by AgentHub: a fixed read-only tool allowlist in offline mode, with the working directory limited to the project root by the main process.",
  },
  docsUrl: "https://pi.dev/",
  installHint: "按 pi.dev 的安装说明安装本机 pi CLI",
  binaries: { win: ["pi.cmd", "pi.exe", "pi"], unix: ["pi"] },
  permissions: [
    "read",
    "grep",
    "find",
    "ls",
    "project-root",
  ] as WorkerPermissionToken[],
  runner: "available",
  supportsModelSelection: true,
} as const;

type CatalogSource =
  | (WorkerMarketEntry & { builtIn?: false })
  | typeof PI_RUNNER_ENTRY;

const CATALOG_SOURCES: readonly CatalogSource[] = [
  PI_RUNNER_ENTRY,
  ...WORKER_MARKET,
];

export const CATALOG_IDS: readonly string[] = CATALOG_SOURCES.map(
  (source) => source.id,
);

function isCatalogId(value: unknown): value is string {
  return typeof value === "string" && CATALOG_IDS.includes(value);
}

function userDataPath(): string {
  return app.getPath("userData");
}

function readState(path: string): CatalogState {
  const empty: CatalogState = { version: STORE_VERSION, installedIds: [] };
  if (!existsSync(path)) return empty;
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<CatalogState>;
    if (
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.installedIds)
    ) {
      return empty;
    }
    const agentModels: Record<string, string> = {};
    if (parsed.agentModels && typeof parsed.agentModels === "object") {
      for (const [id, model] of Object.entries(parsed.agentModels)) {
        const clean = sanitizeWorkerModel(model);
        if (isCatalogId(id) && clean) agentModels[id] = clean;
      }
    }
    return {
      version: STORE_VERSION,
      installedIds: parsed.installedIds.filter(isCatalogId),
      ...(Object.keys(agentModels).length > 0 ? { agentModels } : {}),
    };
  } catch {
    return empty;
  }
}

/**
 * The user's explicit AgentHub choices, kept in the desktop's own userData
 * directory as a versioned file. Detection is never written here: an agent
 * becomes schedulable only because the user connected it.
 */
export class AgentHubCatalogStore {
  private readonly path: string;
  private state: CatalogState;

  constructor(path = join(userDataPath(), STORE_FILENAME)) {
    this.path = path;
    this.state = readState(path);
  }

  selectedIds(): string[] {
    return [...this.state.installedIds];
  }

  isSelected(id: string): boolean {
    return this.state.installedIds.includes(id);
  }

  select(id: string): void {
    if (!isCatalogId(id)) {
      throw new Error(`Unknown AgentHub candidate '${id}'.`);
    }
    if (!this.state.installedIds.includes(id)) {
      this.state = {
        ...this.state,
        installedIds: [...this.state.installedIds, id],
      };
      this.persist();
    }
  }

  remove(id: string): void {
    if (!isCatalogId(id)) {
      throw new Error(`Unknown AgentHub candidate '${id}'.`);
    }
    const installedIds = this.state.installedIds.filter((item) => item !== id);
    const agentModels = { ...(this.state.agentModels ?? {}) };
    delete agentModels[id];
    if (installedIds.length !== this.state.installedIds.length) {
      this.state = { ...this.state, installedIds, agentModels };
      this.persist();
    }
  }

  /** Model chosen from the Hermes library, or null for the CLI's own default. */
  modelFor(id: string): string | null {
    return this.state.agentModels?.[id] ?? null;
  }

  setModel(id: string, model: string | null): void {
    if (!isCatalogId(id)) {
      throw new Error(`Unknown AgentHub candidate '${id}'.`);
    }
    const agentModels = { ...(this.state.agentModels ?? {}) };
    if (model) agentModels[id] = model;
    else delete agentModels[id];
    this.state = { ...this.state, agentModels };
    this.persist();
  }

  private persist(): void {
    safeWriteFile(this.path, `${JSON.stringify(this.state, null, 2)}\n`);
  }
}

let defaultStore: AgentHubCatalogStore | null = null;

export function getAgentHubCatalogStore(): AgentHubCatalogStore {
  return (defaultStore ??= new AgentHubCatalogStore());
}

export function resetAgentHubCatalogStore(): void {
  defaultStore = null;
}

/**
 * A detected CLI is only usable while its launch target still exists. A damaged
 * npm install leaves a `.cmd` shim pointing at a renamed or deleted binary
 * (Claude Code's shim does exactly that after a failed self-update), and such an
 * agent would fail on every run.
 */
function isLaunchHealthy(executablePath: string): boolean {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(executablePath)) {
    return true;
  }
  return resolveWindowsShimEntry(executablePath) !== null;
}

function buildNote(
  source: CatalogSource,
  detected: boolean,
  selected: boolean,
  launchHealthy: boolean,
): LocalizedText | undefined {
  if (source.runner !== "available") {
    return {
      zh: "安全 Runner 尚未实现：可以先按说明安装，等只读参数在本机复验后再开放接入。",
      en: "A safe runner is not implemented yet: install it from the instructions, and connecting opens once its read-only flags are verified on this machine.",
    };
  }
  if (source.runner === "available" && detected && !launchHealthy) {
    return {
      zh: "本机 CLI 已探测到，但它指向的目标文件不存在，安装可能已损坏，请重新安装后再接入。",
      en: "The local CLI was detected but the target it points at is missing, so the install looks damaged — reinstall it before connecting.",
    };
  }
  if (!detected) {
    return {
      zh: "本机未探测到该命令行工具，请先按安装说明安装。",
      en: "This CLI was not found on this machine; install it first.",
    };
  }
  if (!selected) {
    return {
      zh: "已探测到本机 CLI。选择「安装到 AgentHub」后，它才会出现在可运行列表。",
      en: "The local CLI was detected. It becomes runnable only after you connect it to AgentHub.",
    };
  }
  return undefined;
}

export interface CatalogProbe {
  /** Resolve executable names to absolute paths in one batch. */
  resolve: (names: readonly string[]) => Map<string, string>;
  /** Read a CLI version for a resolved path. */
  version: (path: string) => string | null;
}

const DEFAULT_CATALOG_PROBE: CatalogProbe = {
  resolve: probeCliCommands,
  version: readCliVersionCached,
};

function buildEntry(
  source: CatalogSource,
  selected: boolean,
  probe: CatalogProbe,
  found: Map<string, string>,
  model: string | null,
): WorkerCatalogEntry {
  const names =
    process.platform === "win32" ? source.binaries.win : source.binaries.unix;
  const executablePath =
    names.map((name) => found.get(name)).find(Boolean) ?? null;
  const version = executablePath ? probe.version(executablePath) : null;
  const detected = Boolean(executablePath);
  const launchHealthy = executablePath
    ? isLaunchHealthy(executablePath)
    : false;
  const installable =
    source.runner === "available" && detected && launchHealthy;
  return {
    id: source.id,
    name: source.name,
    vendor: source.vendor,
    category: source.category,
    rank: source.rank,
    role: source.role,
    description: source.description,
    docsUrl: source.docsUrl,
    installHint: source.installHint,
    detected,
    installed: selected,
    enabled: selected && installable,
    executablePath,
    version,
    permissions: [...source.permissions],
    installable,
    runner: source.runner,
    builtIn: source.rank === null,
    model,
    supportsModelSelection: source.supportsModelSelection === true,
    note: buildNote(source, detected, selected, launchHealthy),
  };
}

export function listAgentHubCatalog(
  store = getAgentHubCatalogStore(),
  probe: CatalogProbe = DEFAULT_CATALOG_PROBE,
): WorkerCatalogResult {
  const selected = new Set(store.selectedIds());
  const names = CATALOG_SOURCES.flatMap((source) =>
    process.platform === "win32"
      ? [...source.binaries.win]
      : [...source.binaries.unix],
  );
  const found = probe.resolve(names);
  const entries = CATALOG_SOURCES.map((source) =>
    buildEntry(
      source,
      selected.has(source.id),
      probe,
      found,
      store.modelFor(source.id),
    ),
  ).sort((a, b) => (a.rank ?? -1) - (b.rank ?? -1));
  return { entries };
}

function requireEntry(
  id: unknown,
  store = getAgentHubCatalogStore(),
  probe: CatalogProbe = DEFAULT_CATALOG_PROBE,
): WorkerCatalogEntry {
  if (!isCatalogId(id)) {
    throw new Error(`Unknown AgentHub candidate '${String(id)}'.`);
  }
  const entry = listAgentHubCatalog(store, probe).entries.find(
    (item) => item.id === id,
  );
  if (!entry) throw new Error(`Unknown AgentHub candidate '${String(id)}'.`);
  return entry;
}

function refusalMessage(entry: WorkerCatalogEntry): string {
  return (
    [entry.note?.zh, entry.note?.en].filter(Boolean).join(" ") ||
    `${entry.name} cannot be connected right now.`
  );
}

export function installAgentHubSelection(
  id: unknown,
  store = getAgentHubCatalogStore(),
  probe: CatalogProbe = DEFAULT_CATALOG_PROBE,
): WorkerCatalogResult {
  const entry = requireEntry(id, store, probe);
  if (!entry.detected || !entry.installable) {
    throw new Error(refusalMessage(entry));
  }
  store.select(entry.id);
  clearCliProbeCache();
  return listAgentHubCatalog(store);
}

export function removeAgentHubSelection(
  id: unknown,
  store = getAgentHubCatalogStore(),
  probe: CatalogProbe = DEFAULT_CATALOG_PROBE,
): WorkerCatalogResult {
  requireEntry(id, store, probe);
  store.remove(String(id));
  return listAgentHubCatalog(store);
}

export function getSelectedAgentHubIds(): string[] {
  return getAgentHubCatalogStore().selectedIds();
}

export { STORE_FILENAME, STORE_VERSION };

export type { AgentHubModelOption };

/**
 * The models the user already configured in Hermes, offered as the default
 * picker for each connected agent. AgentHub never adds a provider, key, or
 * endpoint of its own here.
 */
export function listAgentHubModelOptions(
  profile?: string,
): AgentHubModelOption[] {
  try {
    return listModels(profile).map((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      label: row.name?.trim() || row.model,
    }));
  } catch {
    return [];
  }
}

function findLibraryModel(
  options: readonly AgentHubModelOption[],
  model: string,
): AgentHubModelOption | undefined {
  return options.find(
    (option) => option.model === model || option.id === model,
  );
}

/**
 * Pin one connected agent to a model: normally an entry from the Hermes library,
 * or a model id the user sets for this agent alone. A value outside the library
 * is allowed but logged, because it is then resolved by that CLI's own provider
 * configuration rather than by Hermes. Unsafe values are refused: this string
 * lands in a child process's argv.
 */
export function setAgentHubWorkerModel(
  id: unknown,
  model: unknown,
  store = getAgentHubCatalogStore(),
  options = listAgentHubModelOptions(),
  probe: CatalogProbe = DEFAULT_CATALOG_PROBE,
): WorkerCatalogResult {
  const entry = requireEntry(id, store, probe);
  if (!entry.supportsModelSelection) {
    throw new Error(
      `${entry.name} / this agent cannot take a model argument yet.`,
    );
  }
  const cleared = model === null || model === undefined || model === "";
  const chosen = cleared ? null : sanitizeWorkerModel(model);
  if (!cleared && !chosen) {
    throw new Error(
      "模型名不能包含会交给命令行解释的字符，请从 Hermes 模型库里选择，或只填模型 ID。 / That model id contains characters AgentHub will not pass to a CLI.",
    );
  }
  if (chosen && !findLibraryModel(options, chosen)) {
    console.info(
      `[agenthub] '${entry.id}' is pinned to '${chosen}', which is not in the Hermes library; the CLI resolves it with its own provider config.`,
    );
  }
  store.setModel(entry.id, chosen);
  return listAgentHubCatalog(store, probe);
}
