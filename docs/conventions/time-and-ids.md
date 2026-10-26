# Time & IDs

Getting these wrong corrupts sync and makes "yesterday" mean the wrong day. Both live in `@dhyan/shared`.

## IDs

| Function | Use | Format |
|---|---|---|
| `newId()` | Any row created by a user action or as a new record (raw logs, manual tasks, projects, devices) | UUIDv7 (time-ordered → good index locality, sortable) |
| `derivedId(kind, ...parts)` | Any row whose identity is determined by other rows: extracted activities/tasks (`rawLogId`, `ordinal`), tags (`path`), entity_tags, entities, mentions, daily briefs (`date`) | UUIDv5 with the fixed app namespace `DHYAN_NAMESPACE`; parts joined with `\u001f` |

Rules:
- IDs are always generated on the client (or server workers) — never by the database.
- Never derive meaning by parsing an ID (even UUIDv7's timestamp).
- The namespace constant must never change once data exists.
- The original spec's UUIDv4 is replaced by v7/v5 ([ADR-0006](../decisions/0006-uuidv7-and-deterministic-ids.md)).

## Instants (`*_at`)

- Stored as UTC ISO-8601 with milliseconds and `Z`: `2026-10-26T14:03:11.402Z`. SQLite: text; Postgres: `timestamptz(3)`; wire: string.
- Always from `clock.now()`:
  - monotonic per device: `max(Date.now(), lastIssued + 1 ms)`; `lastIssued` persisted in `sync_state.clock_last` so it survives restarts,
  - injectable in tests (`createTestClock()`).
- String comparison of these ISO strings is chronological (same format, same zone) — LWW relies on this; never store other formats.

## Local dates (`*_date`)

- `YYYY-MM-DD` in the **user's local calendar** at the relevant time — not UTC. "Ran yesterday" captured at 00:30 local on the 27th → `logged_date = 2026-10-26`.
- Every raw log stores `captured_tz` (IANA). Extraction resolves relative dates against `captured_at` in `captured_tz` — not against processing time, not the server's zone.
- Helpers: `localDate(instant, tz)`, `resolveRelativeDate(expr, anchorInstant, tz)` (validation of model output), `todayLocal(tz)`. Use `Temporal` polyfill or `date-fns-tz`; don't hand-roll offset math.
- Week start: Monday (setting). Day boundary: midnight local (setting for night owls: "day ends at 04:00" — open question).

## Durations & numbers

- Durations as integer minutes in metrics (`duration_min`), seconds only where precision matters.
- Storage units are metric; conversion happens in the normalizer and display layer.
