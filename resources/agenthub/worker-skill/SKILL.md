---
name: agenthub-worker
description: Dispatch a controlled AgentHub Worker through the desktop tool API. Use when a task should be executed by an external worker instead of by Hermes itself.
---

# AgentHub Worker tools

Hermes must not launch Pi, Codex, Claude Code, or any other agent with a raw shell command. Ask the desktop's local tool API instead.

The desktop injects these environment variables into the local gateway:

- `AGENTHUB_WORKER_URL` — loopback POST endpoint
- `AGENTHUB_WORKER_TOKEN` — bearer token

Call:

```http
POST $AGENTHUB_WORKER_URL
Authorization: Bearer $AGENTHUB_WORKER_TOKEN
Content-Type: application/json

{"tool":"worker.start","arguments":{"workerId":"echo","prompt":"..."}}
```

Allowed tools: `worker.list`, `worker.start`, `worker.prompt`, `worker.read`, `worker.wait`, `worker.cancel`, `worker.retry`, `worker.inspect`.

Never send `command`, `args`, `env`, or `shell`. Never log the token.
