# 0019 — Desktop SQLite through the app's own Rust commands, not tauri-plugin-sql

- **Status:** Accepted
- **Date:** 2026-10-29

## Context
The desktop app runs Drizzle's `sqlite-proxy` driver in the webview over a small `SqliteExecutor` (`run`, `values`). The plan was to back it with `tauri-plugin-sql`. Two properties of that plugin don't fit:

- **Connection pool.** It runs SQLite through a sqlx pool. The client store's transactions are `BEGIN IMMEDIATE` … `COMMIT` sent as separate calls (`packages/db/src/client/database.ts`). Successive calls can land on different pooled connections, so statements may run outside the transaction they belong to.
- **Row shape.** `select` returns rows as objects keyed by column name. Drizzle needs arrays in select order, and objects lose columns whose names repeat (joins selecting two `id`s).

A third need follows from having two webviews (dock and main window): one window's open transaction must not interleave with the other window's statements.

## Decision
Ship thin commands in `src-tauri/src/commands/db.rs` on `rusqlite` (with SQLite `bundled`):

- `db_open`: opens or reopens **one connection per window label**, applying the pragmas from [database conventions](../conventions/database.md) (WAL, `synchronous=NORMAL`, `foreign_keys=OFF`, `busy_timeout=5000`).
- `db_run`: runs one statement (outside a transaction).
- `db_values`: runs one statement and returns its rows as arrays of column values.
- `db_batch`: runs several statements and optionally a final query, in one call.
- `db_rollback`: rolls back only if a transaction is open.

Each IPC call costs about 1 ms, so inside a transaction the TS executor queues statements that return nothing and sends them with the next query or with COMMIT (`db_batch`). A plain capture takes 2 calls instead of 5. A failing queued write rejects that later call instead of its own; the transaction still rolls back. Repositories avoid `RETURNING` where they already know the full row (`insertSyncedRow`), so those inserts can be queued too.

Parameters are limited to null, boolean, number and string. SQLite's own locking (WAL + busy timeout) arbitrates between the windows' connections, exactly as between processes.

## Alternatives considered
- **tauri-plugin-sql with a pool of size 1.** That fixes interleaving inside one window but not the row shape. Both windows would share the one connection, so one window's transaction could still interleave with the other's statements.
- **Capture transaction as a Rust command** (the fallback named in [desktop.md](../architecture/desktop.md#data-layer)). That would put business logic (repositories, outbox) in Rust. It stays the fallback only if IPC overhead breaks the 10 ms capture budget.
- **SQLite WASM + OPFS in the webview.** WebView2 storage can be evicted and isn't reachable from Rust or the hub sidecar.

## Consequences
- No `tauri-plugin-sql` dependency, and one less capability to grant.
- Rust owns the database file path (`<app data>/avchetan.db`), so later Rust features (backups, hub sidecar handoff) can reach it.
- Each window runs its own monotonic clock over the shared `clock_last`. In Phase 2 only the dock writes synced tables. From Phase 3 the main window edits data by asking the dock to run a named action, so one clock issues every synced timestamp (`apps/desktop/src/services/actions.ts`).
- The TS executor is tested against an in-process stand-in for these commands (`apps/desktop/src/native/sqlite.test.ts`).
