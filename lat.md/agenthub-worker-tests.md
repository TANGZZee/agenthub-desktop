---
lat:
  require-code-mention: true
---

# AgentHub worker tests

These tests prove the M1 Worker loop without launching Pi, Codex, or Claude Code.

## Start failure

A spawn error is recorded as a failed run with a redacted error instead of throwing out of the tool dispatcher.

## Timeout

A worker that stays alive past its admitted timeout is killed and marked `timed_out`.

## Cancel

An in-flight run can be cancelled and reaches the `cancelled` terminal status.

## Secret filtering

API keys and bearer tokens that appear in worker output or prompt previews are redacted before they are returned.

## Admission rejects arbitrary commands

A `worker.start` payload that includes `command` is rejected with `forbidden_field` and does not spawn a process.

## Pi profile admission

The registered Pi profile keeps the executable-owned arguments, read-only tool allowlist, final-argument prompt placement, and project-root working-directory boundary fixed in code.

## Market catalog

The catalog lists the ten ranked market CLIs after AgentHub's built-in runner, refuses to connect any candidate without a reviewed runner, and rejects unknown ids.

## Readiness preflight

Pi's profile declares credential probes, a run whose probes all fail is refused with `worker_not_ready` and spawns nothing, and a run starts once one probe passes.

## Windows shim launch

A Windows `.cmd` shim resolves to the JavaScript entry it was generated for, and an unresolvable shim fails with a readable launch error.

## Per-agent model choice

A chosen model reaches the CLI's argv in place of the profile placeholder, the flag disappears when no model is chosen, a model id that is unsafe for a command line is refused, and an agent whose runner has no model flag rejects the setting.
