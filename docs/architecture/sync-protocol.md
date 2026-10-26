# Sync Protocol

Single-user, multi-device, outbox-based delta sync with Last-Write-Wins. Implemented in `packages/sync` (client engine + `./protocol` schemas) and `apps/server` (endpoints). Decisions: [ADR-0004](../decisions/0004-outbox-sync-lww.md), [ADR-0005](../decisions/0005-server-cursor-and-tombstones.md).

## Guarantees

- **Eventual convergence:** all devices that complete a sync cycle after the last write hold identical rows.
- **No lost local writes:** a change leaves the outbox only after the server acknowledges it.
- **No missed remote writes:** pulls use a server-issued, gap-free cursor, not device clocks.
- **Deletes propagate:** deletes are tombstones (`deleted_at`) and sync like updates.
- **Idempotent:** pushing or pulling the same data twice has no further effect.

Non-goals: field-level merging, CRDTs, real-time push. Last whole-row write wins; for a single user this is acceptable.

## Outbox

`sync_outbox` holds **pointers**, not payloads: `(table_name, record_id)` primary key, `enqueued_at`, `attempts`, `last_error`.

- The repository layer upserts the outbox row in the **same transaction** as the data write (`INSERT … ON CONFLICT(table_name, record_id) DO UPDATE SET enqueued_at = excluded.enqueued_at`). Ten edits to one task = one outbox row.
- At push time the engine reads the **current** row for each pointer. Deletes are just rows with `deleted_at` set — there is no separate DELETE operation. (The original spec's `operation`/`payload` columns are dropped.)
- After ack, the engine deletes the outbox row **only if `enqueued_at` is unchanged** since it was read, so an edit made during an in-flight push is not lost.

## Conflict resolution (LWW)

A version is the pair `(updated_at, updated_by_device)`. Incoming wins iff it is lexicographically greater than the stored version. Applied identically on the server (push) and on clients (pull). Equal versions = same write → no-op.

**Clock safety:**
- `clock.now()` is monotonic per device: `max(Date.now(), last + 1ms)`, persisted in `sync_state.clock_last`.
- Server rejects pushed rows with `updated_at` more than 5 minutes ahead of server time (`rejected: clock_skew`); client surfaces "device clock is wrong" and retries after correction.
- Clients never use their clock to decide *what to pull* — only the server cursor.

**Local edits vs incoming pull:** if a pulled row loses LWW against the local row, it is skipped (the local row is in the outbox and will win on the server too). If it wins, it overwrites the local row and any outbox pointer for that record is removed (the local change already lost).

**Special cases:**
- `raw_logs.content` is immutable; a mismatch on the same ID is a bug → log error, keep server version.
- `is_user_edited` rows are never overwritten by *extraction*, but normal LWW still applies between devices.

## Push — `POST /v1/sync/push`

Request:
```json
{
  "deviceId": "0192…",
  "batchId": "0192…",
  "changes": [
    { "table": "tasks", "row": { "id": "…", "title": "…", "updatedAt": "…", "updatedByDevice": "…", "deletedAt": null, "…": "…" } }
  ]
}
```
- Max 500 changes per request; engine loops until the outbox is empty.
- Rows are validated per table with the Zod schemas from `@avchetan/sync/protocol` (camelCase on the wire).

Server, per change, inside one transaction per request:
```
INSERT … ON CONFLICT (id) DO UPDATE SET …, server_seq = nextval('sync_seq')
WHERE (excluded.updated_at, excluded.updated_by_device) > (t.updated_at, t.updated_by_device)
```
New inserts also take `nextval('sync_seq')`. Then the embedding/fallback workers are nudged for affected `raw_logs`.

Response:
```json
{ "acked": [ { "table": "tasks", "id": "…" } ],
  "rejected": [ { "table": "…", "id": "…", "code": "validation | clock_skew | unknown_table", "message": "…" } ],
  "serverTime": "2026-10-26T14:03:11.402Z" }
```
Rows that lost LWW are **acked** (the conflict is resolved). Rejected rows stay in the outbox with `attempts++`; after 10 attempts they're flagged in the UI ("sync issue") and skipped until the user acts.

## Pull — `GET /v1/sync/pull?cursor=<n>&limit=500`

```json
{ "changes": [ { "table": "activities", "row": { … }, "seq": 1043 } ],
  "nextCursor": 1043, "hasMore": false }
```
- Returns rows from all synced tables with `server_seq > cursor`, ordered by `server_seq`, including tombstones.
- Client applies each page in one local transaction with LWW, then stores `nextCursor` in `sync_state.pull_cursor` **in the same transaction**. Loop while `hasMore`.
- Applying pulled rows does **not** enqueue the outbox.
- Rows pushed by this device come back in the pull; LWW makes them no-ops.
- `cursor=0` = full bootstrap (new device or reset).

Sequence gaps from rolled-back transactions are harmless (cursor is "greater than", not "next").

Concurrency caveat: if two transactions take sequence numbers and the lower one commits *after* a pull has already read past the higher one, that pull skips the row forever. Mitigation: **every server write that takes `nextval('sync_seq')`** (push handler, fallback extraction, daily-brief fallback) runs inside `pg_advisory_xact_lock(SYNC_WRITE_LOCK)`, so sequence numbers are assigned and committed in order. Single user → negligible contention. A helper `withSyncWrite(tx => …)` in `apps/server` is the only way to write synced tables on the server.

## Sync cycle

```
cycle():
  if !network.online or no server configured → return
  acquire in-process mutex (one cycle at a time)
  push loop until outbox empty or error
  pull loop until !hasMore
  then: wake pending-processor (logs may have been processed elsewhere)
  record last_push_at/last_pull_at; emit 'sync:done' (UI invalidates queries)
```

Triggers:
- 2 s debounce after any local write that enqueued the outbox.
- Network transition offline → online.
- Every 60 s while the app is in foreground / dock process alive; every 15 min via background task on Android.
- Manual: tray "Sync now", `/sync` command, pull-to-refresh on mobile.

Failures: exponential backoff 2 s → 5 min with jitter; reset on success or network transition. HTTP 401 → stop and show "sync token invalid".

**Order matters on reconnect:** sync first, then process pending logs — the server or another device may already have processed some of them.

## Bootstrap & reset

- New device: `POST /v1/devices/register` (name, platform) → returns `deviceId` (or device generates UUIDv7 and registers it). Pull from cursor 0.
- "Reset local data": wipe DB, keep device ID, pull from 0. Unpushed outbox items are exported to a JSON file first.

## Schema evolution

- Wire payloads include only known columns; unknown incoming fields are dropped by Zod (`.strip()`), so an older client tolerates a newer server.
- Additive changes only (new nullable columns, new tables). Renames/removals require a migration plan ADR.
- The protocol has a version header `X-Avchetan-Protocol: 1`; server rejects unsupported majors with 426.

## Tests required

See also [testing](../conventions/testing.md).

Two in-memory SQLite clients + PGlite server: concurrent edits, delete vs edit, offline divergent edits, interrupted push (ack lost), duplicate pushes, pull pagination across tables, clock skew rejection, cursor bootstrap.
