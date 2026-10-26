# 0005 — Server-issued pull cursor and soft-delete tombstones

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The original spec pulled with `since=<last_sync_timestamp>` (the client's clock) and modeled deletes as a `DELETE` operation. A device whose clock is behind skips rows forever. Hard deletes never reach a device that pulls later.

## Decision
- The server assigns `server_seq` from a global sequence on every applied write; clients pull with `cursor=<last server_seq>`. Server writes are serialized with an advisory lock so sequence order equals commit order.
- Deletes are soft (`deleted_at`) on all synced tables and sync like updates. The janitor purges tombstones older than 90 days once every device has pulled past them.
- Client clocks are used only for LWW ordering, monotonic per device, with a ±5 min skew check on push.

## Consequences
- Every read must filter `deleted_at IS NULL` (helper `live()`).
- Adds a `server_seq` column + index per synced table on Postgres.
