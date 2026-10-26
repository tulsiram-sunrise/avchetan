# 0010 — Device-first extraction with server fallback

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Extraction could run on the client (instant, works with local Ollama, no server needed) or on the server (single key location, runs while the phone sleeps). Running on every client that sees a pending log would double-process logs.

## Decision
- The **origin device** (the one that captured the log) processes its own logs as soon as possible.
- The **server** processes a log only if it is still `pending_llm` 15 minutes (configurable) after it first reached the server and no unexpired lease exists. It claims logs with `FOR UPDATE SKIP LOCKED` inside the sync write lock.
- Other devices never process a log they didn't capture, unless the user explicitly chooses "Retry here".
- Deterministic derived IDs make any remaining double processing harmless.
- `privacy = local_only` logs are never processed by the server unless its extraction slot is a local model.

## Consequences
- The server needs its own provider keys (env) and runs `@dhyan/core` extraction.
- Lease fields and attempt counters live on `raw_logs` and sync.
- More moving parts than either pure option. Mitigated by the lease pattern and tests simulating device + server races.
