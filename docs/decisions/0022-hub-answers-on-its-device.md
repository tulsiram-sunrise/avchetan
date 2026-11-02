# 0022 — The hub answers questions on its own device

- **Status:** Accepted
- **Date:** 2026-11-03
- **Builds on:** [ADR-0021](0021-server-organizes-as-a-device.md)

## Context
Roadmap step 5 called for `POST /v1/ask` with Postgres versions of the analysis tools, so a phone without its own model can ask the hub. The tools (`query_activities`, `aggregate_metrics`, `query_tasks`, `streaks`, `search_entries`, `get_logs` and the rest) and their privacy rules are written for the clients' SQLite schema. A second set would have to give the same answers forever.

The server's own device (ADR-0021) already keeps a complete, synced copy of the entries in exactly that schema.

## Decision
- `POST /v1/ask` runs the apps' own `ask()` on the server device's store, with the hub's model (`ANALYSIS_PROVIDER`, `ANALYSIS_MODEL`). It syncs that copy first, so a question asked right after a capture sees it.
- The server device opens when the hub organizes entries, answers questions, or both.
- `search_history` on the hub calls its own search directly.
- The answer streams as server-sent events: `text` (the whole answer so far), then `done` with the cited raw log IDs, or `error` with the model's code. The device shows the cited entries from its own database.
- On a device, the local setting `analysis.mode` (`self` | `hub`) picks who answers. With `hub` the device needs no analysis model or key, and Ask needs the hub to be reachable.

## Consequences
- One set of analysis tools and privacy rules. The privacy scope follows the hub's model: a local model may read private entries, a cloud one never does.
- The hub's answer is only as current as its copy, which is synced at the start of every question.
- Offline, a device on `hub` shows its own counts, as it does without a cloud model.
