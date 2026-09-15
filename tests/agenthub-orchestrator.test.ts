import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKER_MODEL_PLACEHOLDER,
  type WorkerProfile,
  type WorkerRunRecord,
} from "../src/shared/agenthub";
import {
  PI_CREDENTIAL_HINT,
  PI_CREDENTIAL_PROVIDERS,
  createPiWorkerProfile,
  getRegisteredWorkerProfiles,
} from "../src/main/agenthub/profiles";
import { WorkerOrchestrator } from "../src/main/agenthub/orchestrator";
import {
  AgentHubCatalogStore,
  installAgentHubSelection,
  listAgentHubCatalog,
  setAgentHubWorkerModel,
  type CatalogProbe,
} from "../src/main/agenthub/catalog";
import { MARKET_ENTRIES } from "../src/main/agenthub/market";
import {
  echoWorkerCommand,
  resolveWindowsShimEntry,
  resolveWorkerLaunch,
  type ProcessRunner,
} from "../src/main/agenthub/runner";
import { redactSecrets } from "../src/main/agenthub/redact";

const TEST_CWD = join(process.cwd(), "Temp", "tests", "agenthub-worker");

/** Deterministic probe: pretend no coding-agent CLI is installed here. */
const NO_CLI_PROBE: CatalogProbe = {
  resolve: () => new Map<string, string>(),
  version: () => null,
};

function echoProfile(overrides: Partial<WorkerProfile> = {}): WorkerProfile {
  const echo = echoWorkerCommand();
  return {
    id: "echo",
    name: "Echo",
    kind: "echo",
    installed: true,
    enabled: true,
    command: echo.command,
    args: echo.args,
    cwdRoots: [TEST_CWD],
    timeoutMs: 8_000,
    maxConcurrent: 1,
    ...overrides,
  };
}

function createOrchestrator(
  overrides: {
    workers?: WorkerProfile[];
    runner?: ProcessRunner;
  } = {},
): WorkerOrchestrator {
  mkdirSync(TEST_CWD, { recursive: true });
  return new WorkerOrchestrator({
    workers: overrides.workers ?? [echoProfile()],
    runner: overrides.runner,
    defaultCwd: TEST_CWD,
  });
}

async function waitUntil(
  orchestrator: WorkerOrchestrator,
  runId: string,
  predicate: (run: WorkerRunRecord) => boolean,
  timeoutMs = 5_000,
): Promise<WorkerRunRecord> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await orchestrator.dispatch("worker.read", { runId });
    expect(response.ok).toBe(true);
    if (response.ok) {
      const run = response.result as WorkerRunRecord;
      if (predicate(run)) return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const last = await orchestrator.dispatch("worker.read", { runId });
  throw new Error(
    `Timed out waiting for run ${runId}: ${JSON.stringify(last)}`,
  );
}

const live: WorkerOrchestrator[] = [];

afterEach(() => {
  for (const orchestrator of live.splice(0)) orchestrator.shutdown();
});

describe("AgentHub worker orchestrator", () => {
  it("runs the echo worker through start/wait and returns a visible summary", async () => {
    const orchestrator = createOrchestrator();
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "hello from M1",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const run = started.result as WorkerRunRecord;
    const finished = await orchestrator.dispatch("worker.wait", {
      runId: run.runId,
      timeoutMs: 5_000,
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    const record = finished.result as WorkerRunRecord;
    expect(record.status).toBe("succeeded");
    expect(record.output).toContain("WORKER_OK:hello from M1");
    expect(record.summary).toContain("WORKER_OK");
    expect(record.taskId).toBeTruthy();
    expect(record.runId).toBe(run.runId);
  });

  // @lat: [[agenthub-worker-tests#Start failure]]
  it("records start failure when the process cannot be spawned", async () => {
    const orchestrator = createOrchestrator({
      runner: () => {
        throw new Error("spawn ENOENT missing-worker");
      },
    });
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "should fail",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const run = started.result as WorkerRunRecord;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/ENOENT|missing-worker/);
  });

  // @lat: [[agenthub-worker-tests#Timeout]]
  it("times out a worker that does not finish in time", async () => {
    const orchestrator = createOrchestrator({
      workers: [
        echoProfile({
          timeoutMs: 80,
          profileEnv: { AGENTHUB_WORKER_DELAY_MS: "5000" },
        }),
      ],
    });
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "slow",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const run = await waitUntil(
      orchestrator,
      (started.result as WorkerRunRecord).runId,
      (record) => record.status === "timed_out",
    );
    expect(run.status).toBe("timed_out");
    expect(run.error).toMatch(/exceeded/i);
  });

  // @lat: [[agenthub-worker-tests#Cancel]]
  it("cancels a running worker", async () => {
    const orchestrator = createOrchestrator({
      workers: [
        echoProfile({
          timeoutMs: 8_000,
          profileEnv: { AGENTHUB_WORKER_DELAY_MS: "5000" },
        }),
      ],
    });
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "cancel me",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const runId = (started.result as WorkerRunRecord).runId;
    const cancelled = await orchestrator.dispatch("worker.cancel", { runId });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect((cancelled.result as WorkerRunRecord).status).toBe("cancelled");
  });

  // @lat: [[agenthub-worker-tests#Secret filtering]]
  it("redacts secrets from worker output and prompt previews", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz";
    const orchestrator = createOrchestrator();
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: `Authorization: Bearer ${secret}`,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const finished = await orchestrator.dispatch("worker.wait", {
      runId: (started.result as WorkerRunRecord).runId,
      timeoutMs: 5_000,
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    const record = finished.result as WorkerRunRecord;
    expect(record.status).toBe("succeeded");
    expect(record.output).not.toContain(secret);
    expect(record.promptPreview).not.toContain(secret);
    expect(record.output).toMatch(/\[redacted-key\]|Bearer \[redacted\]/);
  });

  // @lat: [[agenthub-worker-tests#Admission rejects arbitrary commands]]
  it("rejects start requests that try to set a command", async () => {
    const orchestrator = createOrchestrator();
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "nope",
      command: "cmd.exe",
    });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe("forbidden_field");
    expect(started.error).toMatch(/command/);
  });
});

// @lat: [[agenthub-worker-tests#Pi profile admission]]
it("registers Pi with a fixed read-only CLI profile", () => {
  const profile = createPiWorkerProfile();
  expect(profile.args).toEqual([
    "--offline",
    "--no-session",
    "--tools",
    "read,grep,find,ls",
    "--model",
    WORKER_MODEL_PLACEHOLDER,
    "-p",
  ]);
  expect(profile.promptPlacement).toBe("final_arg");
  expect(profile.cwdRoots).toEqual([process.cwd()]);
  expect(profile.defaultCwd).toBe(process.cwd());
});

describe("secret redaction helper", () => {
  it("masks common credential shapes", () => {
    const text = redactSecrets(
      "token=ghp_abcdefghijklmnopqrstuvwx Authorization: Bearer abc.def api_key=supersecretvalue",
    );
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwx");
    expect(text).not.toContain("supersecretvalue");
    expect(text).toContain("[redacted");
  });
});

describe("AgentHub catalog selection", () => {
  it("does not register Pi by default", () => {
    expect(getRegisteredWorkerProfiles(TEST_CWD)).toEqual([]);
  });

  it("does not schedule a detected but unselected worker", () => {
    const profile = createPiWorkerProfile(false);
    expect(profile.installed).toBe(false);
    expect(profile.enabled).toBe(false);
    expect(
      new WorkerOrchestrator({
        workers: [profile],
        defaultCwd: TEST_CWD,
      }).list().workers,
    ).toEqual([]);
  });

  it("persists a user selection and registers it only after selection", () => {
    const path = join(TEST_CWD, "catalog-selection.json");
    const store = new AgentHubCatalogStore(path);
    store.select("pi");
    expect(new AgentHubCatalogStore(path).selectedIds()).toEqual(["pi"]);
  });

  it("rejects unknown selections", () => {
    const store = new AgentHubCatalogStore(
      join(TEST_CWD, "catalog-unknown.json"),
    );
    expect(() => store.select("unknown")).toThrow(/Unknown/);
  });
});

// @lat: [[agenthub-worker-tests#Market catalog]]
describe("AgentHub market catalog", () => {
  it("lists the ten ranked market CLIs after the built-in runner", () => {
    // The shipped fallback table is generated from the reviewed catalog JSON, so
    // this also guards that `npm run catalog:sync` was run.
    expect(MARKET_ENTRIES).toHaveLength(10);
    expect(MARKET_ENTRIES.map((entry) => entry.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const entries = listAgentHubCatalog(
      new AgentHubCatalogStore(join(TEST_CWD, "market-order.json")),
      NO_CLI_PROBE,
    ).entries;
    expect(entries).toHaveLength(11);
    expect(entries[0]).toMatchObject({ id: "pi", builtIn: true, rank: null });
    expect(entries.slice(1).map((entry) => entry.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("refuses to connect a candidate that has no reviewed runner", () => {
    const store = new AgentHubCatalogStore(
      join(TEST_CWD, "market-refuse.json"),
    );
    expect(() =>
      installAgentHubSelection("codex", store, NO_CLI_PROBE),
    ).toThrow(/安全 Runner|safe runner/);
    expect(store.selectedIds()).toEqual([]);
  });

  it("rejects an unknown catalog id", () => {
    const store = new AgentHubCatalogStore(
      join(TEST_CWD, "market-unknown.json"),
    );
    expect(() =>
      installAgentHubSelection("not-a-real-cli", store, NO_CLI_PROBE),
    ).toThrow(/Unknown AgentHub candidate/);
  });

  it.skipIf(process.platform !== "win32")(
    "refuses to connect a detected CLI whose launch target is missing",
    () => {
      const dir = join(TEST_CWD, "damaged-cli");
      mkdirSync(dir, { recursive: true });
      const shim = join(dir, "damaged.cmd");
      writeFileSync(shim, "@ECHO off\r\necho nothing\r\n", "utf8");
      const store = new AgentHubCatalogStore(
        join(TEST_CWD, "market-damaged.json"),
      );
      const probe: CatalogProbe = {
        resolve: () => new Map([["pi.cmd", shim]]),
        version: () => null,
      };
      const pi = listAgentHubCatalog(store, probe).entries.find(
        (entry) => entry.id === "pi",
      );
      expect(pi?.detected).toBe(true);
      expect(pi?.installable).toBe(false);
      expect(pi?.note?.zh).toMatch(/损坏/);
      expect(() => installAgentHubSelection("pi", store, probe)).toThrow(
        /损坏|damaged/,
      );
    },
  );
});

// @lat: [[agenthub-worker-tests#Readiness preflight]]
describe("AgentHub readiness preflight", () => {
  it("declares credential probes for the Pi worker", () => {
    const profile = createPiWorkerProfile(true);
    expect(profile.preflight?.probes).toEqual(
      PI_CREDENTIAL_PROVIDERS.map((provider) => [
        "auth",
        "check",
        "--provider",
        provider,
        "--no-refresh",
      ]),
    );
    expect(profile.preflight?.hint).toBe(PI_CREDENTIAL_HINT);
  });

  it("fails fast without spawning when no probe passes", async () => {
    let spawned = false;
    const orchestrator = new WorkerOrchestrator({
      workers: [
        echoProfile({
          preflight: { probes: [["auth", "check"]], hint: "no credentials" },
        }),
      ],
      defaultCwd: TEST_CWD,
      preflightRunner: () => false,
      runner: () => {
        spawned = true;
        throw new Error("should not spawn");
      },
    });
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "should not run",
    });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe("worker_not_ready");
    expect(started.error).toBe("no credentials");
    expect(spawned).toBe(false);
  });

  it("starts the worker once a probe passes", async () => {
    const orchestrator = new WorkerOrchestrator({
      workers: [
        echoProfile({
          preflight: { probes: [["auth", "check"]], hint: "no credentials" },
        }),
      ],
      defaultCwd: TEST_CWD,
      preflightRunner: () => true,
    });
    live.push(orchestrator);
    const started = await orchestrator.dispatch("worker.start", {
      workerId: "echo",
      prompt: "preflight ok",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const finished = await orchestrator.dispatch("worker.wait", {
      runId: (started.result as WorkerRunRecord).runId,
      timeoutMs: 8_000,
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect((finished.result as WorkerRunRecord).output).toContain(
      "WORKER_OK:preflight ok",
    );
  });
});

// @lat: [[agenthub-worker-tests#Windows shim launch]]
describe("AgentHub Windows shim launch", () => {
  it("resolves an npm shim to the JavaScript entry it runs", () => {
    const dir = join(TEST_CWD, "shim");
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, "cli.js");
    writeFileSync(entry, "console.log('PROBE_OK');\n", "utf8");
    const shim = join(dir, "tool.cmd");
    writeFileSync(
      shim,
      '@ECHO off\r\n"%_prog%"  "%dp0%\\cli.js" %*\r\n',
      "utf8",
    );
    expect(resolveWindowsShimEntry(shim)).toBe(entry);
  });

  it("refuses a shim whose JavaScript entry cannot be resolved", () => {
    const dir = join(TEST_CWD, "shim-broken");
    mkdirSync(dir, { recursive: true });
    const shim = join(dir, "broken.cmd");
    writeFileSync(shim, "@ECHO off\r\necho nothing here\r\n", "utf8");
    expect(resolveWindowsShimEntry(shim)).toBeNull();
    if (process.platform !== "win32") return;
    expect(() => resolveWorkerLaunch(shim, ["--version"])).toThrow(
      /does not exist|incomplete or damaged/,
    );
  });

  it("skips the shim's own bundled node reference", () => {
    const dir = join(TEST_CWD, "shim-node");
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, "node_modules", "pkg", "cli.js");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "console.log('REAL');\n", "utf8");
    const shim = join(dir, "tool2.cmd");
    writeFileSync(
      shim,
      [
        "@ECHO off",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        ")",
        '"%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*',
        "",
      ].join("\r\n"),
      "utf8",
    );
    expect(resolveWindowsShimEntry(shim)).toBe(entry);
  });
});

// @lat: [[agenthub-worker-tests#Per-agent model choice]]
describe("AgentHub per-agent model choice", () => {
  it("passes the chosen model to the CLI and omits the flag when unset", async () => {
    const captured: string[][] = [];
    const base = echoProfile({
      args: [
        "--offline",
        "--tools",
        "read",
        "--model",
        WORKER_MODEL_PLACEHOLDER,
        "-p",
      ],
      promptPlacement: "final_arg",
    });
    const orchestrator = new WorkerOrchestrator({
      workers: [
        { ...base, id: "plain" },
        { ...base, id: "with-model", model: "gpt-5.1" },
      ],
      defaultCwd: TEST_CWD,
      runner: (spec) => {
        captured.push(spec.args);
        spec.onExit(0, null);
        return { writeStdin: () => false, kill: () => {} };
      },
    });
    live.push(orchestrator);

    await orchestrator.dispatch("worker.start", {
      workerId: "plain",
      prompt: "no model",
    });
    await orchestrator.dispatch("worker.start", {
      workerId: "with-model",
      prompt: "with model",
    });

    expect(captured[0]).toEqual([
      "--offline",
      "--tools",
      "read",
      "-p",
      "no model",
    ]);
    expect(captured[1]).toEqual([
      "--offline",
      "--tools",
      "read",
      "--model",
      "gpt-5.1",
      "-p",
      "with model",
    ]);
  });

  it("stores a library model and a standalone custom model for one agent", () => {
    const store = new AgentHubCatalogStore(join(TEST_CWD, "model-choice.json"));
    const options = [
      {
        id: "m1",
        label: "Sonnet",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      },
    ];

    const picked = setAgentHubWorkerModel(
      "pi",
      "claude-sonnet-4-5",
      store,
      options,
      NO_CLI_PROBE,
    );
    const entry = picked.entries.find((item) => item.id === "pi");
    expect(entry?.model).toBe("claude-sonnet-4-5");
    expect(entry?.supportsModelSelection).toBe(true);

    const custom = setAgentHubWorkerModel(
      "pi",
      "openrouter/deepseek-v3",
      store,
      options,
      NO_CLI_PROBE,
    );
    expect(custom.entries.find((item) => item.id === "pi")?.model).toBe(
      "openrouter/deepseek-v3",
    );

    setAgentHubWorkerModel("pi", null, store, options, NO_CLI_PROBE);
    expect(store.modelFor("pi")).toBeNull();
  });

  it("refuses a model id that must not reach a command line", () => {
    const store = new AgentHubCatalogStore(join(TEST_CWD, "model-unsafe.json"));
    expect(() =>
      setAgentHubWorkerModel("pi", "bad$(whoami)", store, [], NO_CLI_PROBE),
    ).toThrow(/不能包含|characters/);
    expect(store.modelFor("pi")).toBeNull();
  });

  it("refuses a model argument for an agent without a model flag", () => {
    const store = new AgentHubCatalogStore(
      join(TEST_CWD, "model-unsupported.json"),
    );
    expect(() =>
      setAgentHubWorkerModel("codex", "gpt-5.1", store, [], NO_CLI_PROBE),
    ).toThrow(/cannot take a model/);
  });
});
