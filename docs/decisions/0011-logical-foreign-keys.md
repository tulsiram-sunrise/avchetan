# 0011 — Logical (unenforced) foreign keys on synced tables

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Rows arrive by push/pull in `server_seq` order, not dependency order. An activity can arrive before its raw log (for example the raw log was updated later and so has a higher sequence number). Enforced FKs would reject valid data or need complex ordering.

## Decision
Synced tables declare references as indexed columns without enforced FK constraints (SQLite `foreign_keys=OFF` for them; no FK constraints in Postgres). Integrity is maintained by repositories (cascading soft deletes) and checked by tests and an optional integrity check command.

## Consequences
- Readers must tolerate a missing parent briefly (e.g. show "source log syncing…").
- Orphans can only arise from bugs; the integrity check reports them.
