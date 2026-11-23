# 0034 — Edits made on two devices keep the losing version, and say so

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** [ADR-0004](0004-outbox-sync-lww.md) (outbox sync, Last-Write-Wins), [ADR-0019](0019-desktop-sqlite-own-commands.md) (the dock runs the PC's writes)

## Context
Sync is Last-Write-Wins on whole rows ([sync protocol](../architecture/sync-protocol.md#conflict-resolution-lww)). When a task is changed on the phone and on the PC before they sync, the newer row wins everywhere and the other change disappears without a word. v0.5.0's task actions (move, cancel, partly done, notes, reminders) make that likelier. The [roadmap](../roadmap.md#v050--tasks-routines-and-reminders) asked for the losing user edit to be kept and shown, with LWW unchanged so every device still ends the same.

## Decision
- **LWW stays exactly as it is.** Nothing here changes which version wins or what any device ends up with.
- **The losing version is kept on the device that wrote it,** in a new client-only, unsynced table `sync_conflicts` (table, record ID, the whole losing row as JSON, when it was noticed). One per row: a later loss of the same row replaces it.
- **Only hand edits count.** A write made through core's shared writes (`runWrite`: every edit on a screen, every command, Keep this one) runs in a transaction marked *by user*, and the outbox entry it enqueues gets `by_user = 1` (a new column of the client-only `sync_outbox`). A later write by the AI to the same row keeps the mark. Rows written by extraction, the brief, routine days and other automatic work never make a conflict.
- **Two places notice a loss**, as the roadmap set out:
  1. **A pull** that overwrites a row whose change is still waiting in the outbox, marked by user (`applyRemoteChanges`). The local row is kept before it is overwritten.
  2. **The push answer.** The server marks an acked row that lost LWW with `lost: true` (`acked[]`, an additive field: older servers leave it out, older apps ignore it). The server tells a retried push (same version) from a lost one by comparing versions in SQL. The device keeps the row as it pushed it, but only if that outbox entry was still the one it read (an edit made since will be pushed and win).
- **Only differences a person can see.** Each table people edit by hand lists its visible columns (`CONFLICT_COLUMNS` in `packages/db/src/client/conflicts.ts`): tasks (title, notes, due date, done, how it went, partly done, cancelled, reminder, deleted), activities (title, notes, category, numbers, day, deleted), routines (title, kind, repeat rule, window, paused, deleted), entries (private, deleted). *When* something was done, cancelled, paused or deleted isn't shown, only *whether*. Two devices that both marked a task done make no conflict. Other tables (tags, projects, people, categories, context rules) make none.
- **The notice:** *Changed on two devices* on **Days** and **Tasks**, on the PC and the phone, with a line per field that differs (this device's value and the one kept) and two buttons:
  - **Keep this one** writes this device's visible fields again as a new hand edit (`conflict.keepMine`), which syncs and wins everywhere.
  - **Keep the other** forgets this device's version (`conflict.keepTheirs`).
- **A conflict drops itself when it no longer matters:** the row is gone, nothing visible differs any more, or this device edited the row by hand again (that edit clears it at once). A loss the push reported before the winning row has arrived stays hidden until the next pull brings it.
- **Tests:** a randomized convergence test (`fast-check`, fixed seed and device IDs; `apps/server/src/two-device-edits.property.test.ts`) runs random hand edits, deletes, clock steps and syncs on two or three devices against a real server. Every run must end with identical data everywhere, and each device must show a conflict exactly when its last hand edit lost while still waiting to be sent and differs visibly from what was kept.

## Known gap
A hand edit that **reached the server first** and was later replaced by another device's *newer* edit, made without having seen it, is not noticed. Both devices were offline; the one that edited earlier synced first. Neither detection point sees it: the server accepted the first push, and when the second device pushed, its row was simply newer. Noticing it needs each pending change to carry the version it was based on, so the server can tell "replaced an edit you never saw" from "replaced an edit you had". That is a client-only outbox column plus an additive wire field, and it is left as a follow-up in [open questions](../open-questions.md) (Q31: after v0.5.0, decided 2026-11-23).

## Alternatives considered
- **Per-field LWW with a hybrid logical clock.** It merges edits to different fields, but it is a protocol change on every synced table. The roadmap keeps it for later, only if this notice turns out to be common.
- **Keep losers on the server and send them to every device.** Every device would see every loss, including ones it had nothing to do with, and the server would need a new table and endpoint. The device that wrote the edit is the one that cares.
- **Count any loss, not only hand edits.** Two devices organizing the same entry with different models would flood the notice with changes nobody made.
- **Ask before syncing an edit that might conflict.** Sync runs in the background and must never wait on the person (rule 1).

## Consequences
- The client schema gains `sync_conflicts` and `sync_outbox.by_user` (SQLite migration `0009_sync_conflicts`). There is no Postgres change.
- The push answer gains `acked[].lost`. Older apps ignore it; with an older server, only the pull path notices losses.
- Hand-edit code must go through `runWrite` to be counted. A write made straight on the repositories (tests, automatic work) is never shown as a conflict.
- Keep this one restores the visible fields as they were. It doesn't redo side effects such as the next occurrence of a repeating task, which the original edit already made on this device.
