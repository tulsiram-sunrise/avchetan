# 0004 — Custom outbox sync with Last-Write-Wins

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Capture must work offline on two devices and converge when online. There is only one user, so concurrent edits of the same record are rare.

## Decision
Build a small custom sync: a local outbox of changed-record pointers, `POST /push` with row-level LWW on `(updated_at, updated_by_device)`, and `GET /pull` by server cursor. Details: [sync-protocol.md](../architecture/sync-protocol.md).

## Alternatives considered
- **PowerSync / ElectricSQL** — hands-off, but adds a service or vendor dependency, plus setup for Tauri's SQLite; less control.
- **Turso / libSQL embedded replicas** — clean SQLite replication but ties us to that ecosystem; mobile/Tauri support varies.
- **CRDTs (Automerge/Yjs)** — field-level merging we don't need, at significant complexity.

## Consequences
- We own correctness → heavy test requirements for `packages/sync`.
- Whole-row LWW: a concurrent edit to different fields of the same row loses one edit. Acceptable for one user.
- Outbox stores pointers, not payloads (coalesces edits; the original spec stored payload + operation).
