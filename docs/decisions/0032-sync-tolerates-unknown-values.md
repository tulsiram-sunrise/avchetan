# 0032 — Sync passes on values it doesn't know, and sets aside rows it can't read

- **Status:** Accepted
- **Date:** 2026-11-18
- **Builds on:** [ADR-0004](0004-outbox-sync-lww.md) (LWW sync), [ADR-0007](0007-drizzle-dual-dialect-schema.md) (dual-dialect schema), [ADR-0030](0030-repeat-rules-json-own-engine.md) (repeat rules). **Supersedes** the part of [ADR-0031](0031-routine-days-derived-rows.md) that checks a synced repeat rule strictly.

## Context
Devices update at different times: the phone may run a newer Avchetan than the PC for days, and a hub longer still. Until now the wire schemas checked every enum column against the values this app knows (`packages/sync/src/protocol/rows.ts`), and the repeat rule against the strict `repeatRuleSchema`. So the first new value (a new entry source such as Share to Avchetan's, a new routine kind, a new repeat-rule field) would have broken every older device:
- an older device that **pulled** the row failed the whole page (`toRemoteChange` threw), so it stopped syncing until it was updated;
- an older **hub** refused the pushed row (`validation`), which sat in the newer app's outbox until it was stuck;
- the hub's Postgres CHECK constraints on synced enum columns would have refused the value even after its wire check was relaxed.

The fix only helps devices that already have it, so it ships before any new value is used ([R27](../open-questions.md#resolved)).

## Decision
- **The wire takes any enum value an app could write.** Enum columns on synced tables accept any lowercase `snake_case` string of up to 64 characters (`wireEnumSchema`); anything else (empty, capitals, spaces, not a string) is still a bad row. Values from a newer app are stored and passed on unchanged, by clients and by the hub, so LWW and later pushes keep them.
- **The repeat rule on the wire is any JSON object.** A rule a person types is still checked strictly by the repository (ADR-0030). A rule this app can't read stays on the routine and makes no days (`routineRule` returns null), with a `warn` log of the routine's ID.
- **Postgres has no CHECK on synced enum columns** (migration `pg 0010_tolerant_enums`). Server-only tables (`devices`, `server_jobs`) keep theirs: their values come from this server's own code.
- **Code narrows where it reads, to a safe fallback, never a crash.** Comparisons with one known value (`privacy === 'normal'`, `status === 'pending_llm'`) already treat an unknown value as "not that", which is safe: an unknown privacy value counts as private everywhere. Where code would break or do something wrong, it falls back on purpose:
  - an entry's status badge shows an unknown status as *Saved*;
  - `ensureDays` makes days only for the kinds it lists (`assumed`, `confirm`), so an unknown kind makes none;
  - editing an entry's text keeps any privacy value but `normal`, so a stricter value from a newer app is never lowered.
  New code that maps an enum value to something (a label, a branch) gives the unknown case a fallback; [testing](../conventions/testing.md) has the tests for it.
- **A pulled row this app can't read is set aside, not fatal.** A truly invalid row (a bad ID or timestamp, a missing required field), or one with a value in a shape this app can't read, goes into a client-only table `sync_set_aside` (table, record ID, the row as JSON) in the same transaction as the rest of its page, and the cursor moves on. On every sync, before pulling, the set-aside rows are read again with the current schemas and those that now read are applied (after an update, say). A readable version of the same row pulled later replaces it (pulls come in the server's order, so it is newer). The sync status counts them, and the app says *N changes from another device can't be read here. Update Avchetan on this device.*, linking [troubleshooting](../user-guide/troubleshooting.md#sync_set_aside) (decided 2026-11-18).
- **Pushed rows are unchanged:** the hub still rejects a row it can't read at all (`validation`), and it waits in the device's outbox as before. With the wire above, only a row no app could have written is refused.
- **The other half of compatibility stays as it is** ([sync protocol](../architecture/sync-protocol.md#schema-evolution)): an older app drops columns it doesn't know when it pulls and resets them to their defaults when it pushes the row again. Both halves are written down in one place, the protocol's *Schema evolution*.

## Alternatives considered
- **Keep strict schemas and require every device to update first.** Simple, but the phone and PC update on different days, and a hub on someone's always-on PC may lag weeks; sync would stop in between.
- **A protocol version per enum, or a negotiated value list.** The server would have to know every device's version and filter rows per device. A lot of machinery for values that are simply strings.
- **Skip unreadable rows without keeping them.** The cursor moves past them for good, so the row would never arrive here, even after an update. Keeping them costs one small table.
- **Stop the cursor at an unreadable row.** Every later change would wait behind it, which is the failure we are fixing.

## Consequences
- **v0.5.0 adds no new value to a synced enum column and no new repeat-rule field.** Devices without this change would still break on one. The first new value (`mobile_share`) can come in v0.6.0.
- An unknown value can now reach any reader; reviewers check that new mappings have a fallback.
- A newer device's values survive a round trip through an older device: an edit on the older device pushes the row with the value unchanged.
- `sync_set_aside` holds rows another device wrote, so it is part of the local database (backed up with it) and is never shown as entries.
