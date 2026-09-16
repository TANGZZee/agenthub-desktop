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

Pi is detected from the local `pi.cmd`/`pi` installation, but it is registered only after the user connects it in the catalog. Its profile fixes `--offline`, `--no-session`, `--tools read,grep,find,ls`, and `-p`.

The task prompt is appended by the main process as the final argument. See [[agenthub-workers#Readiness preflight]] for the credential gate.

## Desktop visibility

The Workers sidebar page lists registered workers, recent runs, and the loopback tool URL.

The local gateway receives `AGENTHUB_WORKER_URL` and `AGENTHUB_WORKER_TOKEN` so Hermes can call the same tools without writing user CLI configs.

## Catalog & installation

The Workers page lists AgentHub's reviewed runner first, then the market candidates by rank.

Nothing is registered automatically: a candidate becomes runnable only after the user connects it, and connecting requires both a detected local executable and a reviewed runner. Choices live `agenthub-catalog.v1.json` under the desktop's userData directory, so detection never implies consent. Hermes cannot change this list through any `worker.*` tool.

Detection alone is not enough: a detected CLI whose Windows shim points at a missing target is reported as a damaged install and stays unconnectable, because such an agent would fail on every run. See [[agenthub-workers#CLI launch on Windows]].

## Market catalog source

The candidate list is fetched from a published JSON document, so it can grow without shipping a desktop build; the app falls back to a cached copy and then to the table it shipped with.

`docs/catalog/agenthub-market.json` is the single source for both the `docs/catalog/index.html` web page and the app. It is validated twice, with different jobs: `scripts/validate-market-catalog.mjs` is the authoring gate that catches typos before a commit, while [[src/shared/agenthub-market.ts#parseMarketCatalog]] defends the runtime against a tampered response or a corrupt cache — it drops rather than coerces, requires `https:` links, bounds every field, and collapses `installHint` to one line because that value is copied into a terminal.

Three sources, tried in order: a fetched document, the last good one cached under userData, then the generated fallback [[src/main/agenthub/market.generated.ts]]. A failed refresh keeps the previous list and records why, so the Workers page can show which list is on screen. [[src/main/agenthub/market-source.ts]] is what callers read.

**A catalog entry can never grant runnability.** The remote document may add entries, reorder them, and describe them, but `runner` and `supportsModelSelection` are derived locally from [[src/main/agenthub/profiles.ts#REVIEWED_RUNNER_IDS]], and the authoring validator rejects a document that carries a `runner` field at all. An invented id is therefore always "listed only".

## Readiness preflight

A worker is not spawned until its profile's readiness probes pass, so an unusable CLI fails immediately with a readable reason instead of hanging.

[[src/main/agenthub/orchestrator.ts#assertWorkerReady]] first checks that the command is launchable, then runs each probe argv with the profile's own executable and requires at least one zero exit. Pi probes `pi auth check` for google, anthropic, openai, and openrouter, because a Pi run with no model credentials produces no output at all.

## CLI launch on Windows

npm installs Windows CLIs as `.cmd` shims, which Node refuses to spawn directly, so AgentHub runs the JavaScript entry the shim points at.

[[src/main/agenthub/runner.ts#resolveWorkerLaunch]] resolves the `%dp0%`-relative script path inside the shim and starts that entry with Node, keeping the task prompt out of any command interpreter. A shim whose entry cannot be resolved reports a clear error instead of failing with `EINVAL`.

## Discovering a CLI on PATH

[[src/main/agenthub/profiles.ts#probeCliCommands]] resolves a catalog entry's binary names by **walking `PATH` on the filesystem**, not by shelling out to `where.exe`/`which`.

The subprocess approach was wrong twice over. It measured ~3.4 s for the full name set on this machine and, inside Electron, hit its 10 s timeout outright, so every catalog probe stalled and the app reported **zero detected CLIs** on a machine with several installed. Its exit status also caused a second bug: `where.exe` exits non-zero as soon as *one* requested name is missing while still printing the ones it found, and treating that status as failure discarded real hits.

Walking `PATH` costs no child process at all: each directory is listed **once** with `readdir` and every name is answered from that listing, rather than issuing a `stat` per (directory × name × `PATHEXT`) combination — with ~45 PATH entries, 40 names and 9 extensions the naive form was ~16k stats and seconds of work. A cold full-catalog probe is now single-digit milliseconds. Bare names are completed with `PATHEXT`, matching how `where.exe` resolves `claude` to `claude.cmd`.

Version probes are the remaining cost (~0.75 s per hit, since an npm shim starts a Node runtime), so they are **asynchronous** and cached on the same TTL, and run concurrently per entry. See [[sidebar-navigation#Off-screen tabs must stop polling]] for why the tab that triggers this must also stop polling when hidden. Covered by [[tests/agenthub-cli-discovery.test.ts]].

## Per-agent model choice

Each connected agent can be pointed at one model from the Hermes model library, and can also name a model explicitly for itself.

Hermes keeps owning providers, keys, and endpoints: AgentHub stores only a per-agent choice in the same settings file, so connecting an agent never rewrites that CLI's own configuration. The choice replaces a `{model}` placeholder in the worker profile's argv; when it is cleared, the placeholder and the flag before it are dropped so the CLI keeps its default. A value outside the library, or one containing characters that must not reach a command line, is refused.

### The library id and the CLI's own model name are different namespaces

The picker offers the **Hermes model library**, but a CLI resolves models against **its own** catalogue, and the two do not share an id space.

A library entry such as `cn:deepseek-v4.1-flash` is meaningless to Pi, which expects a name from its own list (`Jy/glm-5.3-flash`). Passing the library id through made Pi exit with `Model "…" not found` — and because the failure happened at dispatch, the run admitted and then produced nothing. Picking a model from the list is therefore not a guarantee that a given CLI can serve it; the CLI must also know the name.

## Provisioning a CLI with the Hermes library

A connected CLI is handed the Hermes model library in **its own config format**, written to a directory of ours, so a CLI the user never configured can still run a library model.

This is the mechanism behind "an agent uses the model I configured in Hermes". It cannot be done with environment variables: Pi has no variable for a custom base URL (its vendor variables are fixed — `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, …), and setting `OPENAI_BASE_URL` was measured to reach the real OpenAI instead. Writing the CLI's config file is the only thing that works, and that is verified end to end: a Pi with an empty config reports "No models available", while the same binary with just a `models.json` lists that provider's models and answers a prompt.

Isolation is the point. The generated directory lives under `agenthub-cli-config/<workerId>` in the desktop's `userData`, and the child is pointed at it with `PI_CODING_AGENT_DIR`. The user's own `~/.pi/agent` is never read or written, so their hand-written providers keep working; clearing the worker deletes the generated directory.

Keys come from the profile's `.env`, resolved through the same chain the chat runtime uses — host-derived variable, then `CUSTOM_PROVIDER_<NAME>_KEY`, then `CUSTOM_API_KEY`/`OPENAI_API_KEY`. Reading the wrong profile finds nothing, because profiles keep separate `.env` files. An endpoint with no resolvable key is skipped rather than written with a placeholder, so the CLI cannot list models that would fail to answer.

### The stored endpoint is not the API root

The base URL is completed with `/v1` when it carries no path.

Hermes stores an endpoint roughly as typed — commonly a bare origin such as `https://ai.apiclub.top` — and its own engine appends `/v1` when building a request. A CLI consuming the value as an OpenAI base URL does not: Pi posts to `<base>/chat/completions`, so a bare origin lands on the site's HTML landing page. That is a `200` whose body is not a completion, so it surfaces as "stream ended without finish_reason" instead of a clear error. Measured against the real endpoint, `/chat/completions` returned HTML while `/v1/chat/completions` returned a completion. A URL that already states a path is left exactly as configured.

## Readiness gating

A profile may declare `preflight` probes; at least one must exit 0 or admission fails with the profile's hint instead of spawning a worker that would hang.

Pi's probes are **model-first**. Readiness is a property of the model rather than the vendor, so [[src/main/agenthub/profiles.ts#createPiWorkerProfile]] probes the chosen model when there is one and falls back to Pi's built-in vendor list (`google`/`anthropic`/`openai`/`openrouter`) only when no model is selected. Probing the vendor list alone was wrong for this desktop: the model picker offers the Hermes library, so a working setup typically has credentials under the user's own named endpoints and none of those four vendors — the gate rejected setups that ran fine. When no model is chosen the probe is omitted entirely, since a `--model` probe with an empty value could never pass.

Because the two failure modes (no credential, unknown model) are indistinguishable at the gate but need different fixes, [[src/main/agenthub/profiles.ts#PI_CREDENTIAL_HINT]] names both and points at `pi --list-models` and `pi auth check --model <name>`. Covered by [[tests/agenthub-pi-readiness.test.ts]].

## Office mapping

Connected workers are the subjects of the Office tab: each one is a character whose activity follows its journal.

See [[office-pixel]] for the join itself. The former 3D scene drew Hermes **profiles** and treated workers as read-only scenery; the pixel office inverts that, so the worker layer owns identity and [[agent-activity]] supplies what each agent is doing. A worker that is working right now appears even when it was never connected through the Capabilities screen.
