# AgentHub Workers

The desktop owns a controlled Worker orchestration layer so Hermes can delegate work without launching arbitrary agent CLIs.

Hermes asks for an action through `worker.*` tools. The Electron main process admits the request, starts only a registered worker, stores a redacted run record, and shows status in the Workers tab. See [[agenthub-worker-tests]] for M1 coverage.

## Tool boundary

Eight tools are the only public Worker API: list, start, prompt, read, wait, cancel, retry, and inspect.

[[src/main/agenthub/orchestrator.ts#WorkerOrchestrator#dispatch]] is the single dispatcher used by IPC and the loopback HTTP tool server. Callers cannot pass a command, argv, shell, or environment map.

## Admission

Start requests are checked before any process is created so Hermes cannot smuggle an executable path or working directory outside the worker allowlist.

[[src/main/agenthub/admission.ts#parseStartArgs]] rejects forbidden fields, empty prompts, and oversized prompts. The worker profile supplies the executable.

## Run records

Each attempt stores task, worker, run, status, a short prompt preview, a redacted output summary, and timestamps.

Records never include API keys, tokens, full auth headers, or the worker's private environment. [[src/main/agenthub/orchestrator.ts#WorkerOrchestrator]] keeps live processes in memory for M1.

## Secret filtering

Output, errors, and prompt previews pass through a redaction filter before they are returned to Hermes or the UI.

[[src/main/agenthub/redact.ts#redactSecrets]] masks common key shapes and any values copied from a worker profile's private env.

## Echo adapter

M1 ships one loopback Echo worker so the closed loop can be tested without Pi, Codex, or Claude Code.

The adapter runs a fixed Node script through `ELECTRON_RUN_AS_NODE` and prints the admitted prompt. The Pi adapter is registered separately and does not start automatically.

## Pi adapter

Pi is detected from the local `pi.cmd`/`pi` installation, but it is registered only after the user connects it in the catalog. Its profile fixes `--offline`, `--no-session`, `--tools read,grep,find,ls`, and `-p`; the task prompt is appended by the main process as the final argument. See [[agenthub-workers#Readiness preflight]] for the credential gate.

## Desktop visibility

The Workers sidebar page lists registered workers, recent runs, and the loopback tool URL.

The local gateway receives `AGENTHUB_WORKER_URL` and `AGENTHUB_WORKER_TOKEN` so Hermes can call the same tools without writing user CLI configs.

## Catalog & installation

The Workers page lists AgentHub's reviewed runner first, then the ten most widely used coding-agent CLIs by market rank.

Nothing is registered automatically: a candidate becomes runnable only after the user connects it, and connecting requires both a detected local executable and a reviewed runner. Choices live `agenthub-catalog.v1.json` under the desktop's userData directory, so detection never implies consent. Hermes cannot change this list through any `worker.*` tool.

Detection alone is not enough: a detected CLI whose Windows shim points at a missing target is reported as a damaged install and stays unconnectable, because such an agent would fail on every run. See [[agenthub-workers#CLI launch on Windows]].

## Readiness preflight

A worker is not spawned until its profile's readiness probes pass, so an unusable CLI fails immediately with a readable reason instead of hanging.

[[src/main/agenthub/orchestrator.ts#assertWorkerReady]] first checks that the command is launchable, then runs each probe argv with the profile's own executable and requires at least one zero exit. Pi probes `pi auth check` for google, anthropic, openai, and openrouter, because a Pi run with no model credentials produces no output at all.

## CLI launch on Windows

npm installs Windows CLIs as `.cmd` shims, which Node refuses to spawn directly, so AgentHub runs the JavaScript entry the shim points at.

[[src/main/agenthub/runner.ts#resolveWorkerLaunch]] resolves the `%dp0%`-relative script path inside the shim and starts that entry with Node, keeping the task prompt out of any command interpreter. A shim whose entry cannot be resolved reports a clear error instead of failing with `EINVAL`.

## Per-agent model choice

Each connected agent can be pointed at one model from the Hermes model library, and can also name a model explicitly for itself.

Hermes keeps owning providers, keys, and endpoints: AgentHub stores only a per-agent choice in the same settings file, so connecting an agent never rewrites that CLI's own configuration. The choice replaces a `{model}` placeholder in the worker profile's argv; when it is cleared, the placeholder and the flag before it are dropped so the CLI keeps its default. A value outside the library, or one containing characters that must not reach a command line, is refused.

## Office mapping

Connected workers appear in the Office 3D scene as read-only agents with live status.

[[src/renderer/src/screens/Office/office3d/agents.ts#workerToOfficeAgent]] maps each connected worker to an office agent whose status follows its runs: in-flight reads as working, failed / timed_out as error, otherwise idle. The `workerId` marker excludes them from the office chat and bank pickers, so workers never join Hermes-profile actions — the office observes them, it does not act for them.
