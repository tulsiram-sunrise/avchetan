# 0031 — A routine's days are derived rows made on the day, with a fixed early version

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** [ADR-0004](0004-outbox-sync-lww.md) (LWW sync), [ADR-0006](0006-uuidv7-and-deterministic-ids.md) (derived IDs), [ADR-0030](0030-repeat-rules-json-own-engine.md) (repeat rules), [tasks, routines and reminders §3](../product/tasks-routines-reminders.md#3-routines)

## Context
Routines (sleep, work hours, chores) repeat on a rule. The chore checklist (Day 6), chores ticked from entries (Day 7), the brief's *Needs attention* (Day 12) and day coverage (Day 13) all need to know which routines fell on a day and what happened to each. Every device can be offline when the day starts, so any of them may be the first to notice it. Two things must hold:
- Two devices that both notice the day end up with **one** row for it.
- A tick made on one device is **never undone** by another device that notices the same day later. With plain LWW it would be: a phone offline since morning makes today's *Water plants* at 09:00 as `open`, after the PC ticked it at 08:00; the phone's row is newer, so it wins.

## Decision
- **Two synced tables.** `routines` (title, kind `assumed` / `confirm` / `task`, the rule as JSON, an optional `HH:MM` window, category, tag, `paused_at`) and `routine_days` (`routine_id`, `scheduled_date`, `status` `open` / `done` / `skipped`, `status_at`, `raw_log_id`). Both dialects, as every synced table.
- **A day's ID is derived:** `derivedId('routine_day', routine_id, scheduled_date)`. A starter routine's ID is derived from its key (`derivedId('routine', 'starter', key)`), so adding it on two devices makes one routine.
- **Days are made on the day, never for the past.** `ensureDays(today)` makes today's row for each live, unpaused `assumed` or `confirm` routine whose rule falls on today, and leaves an existing row alone. The apps call it when they open and when the date changes. A day nobody opened the app on has no row. A `task` routine's days are tasks (Day 8), not rows here.
- **A made day carries a fixed early version.** Its `created_at` and `updated_at` are midnight UTC at the start of the day **before** its date (`madeDayVersion`). That instant is always in the past, because no time zone is a whole day ahead of UTC, so the server's clock-skew check accepts it. It is also older than anything a person does to the day, because a tick, a skip or a reopen uses `clock.now()`. So a made row never beats a tick, and two devices that make the same day write the same content and settle by LWW without changing it.
- **Ticking ahead is refused.** `setDayStatus` refuses a day whose made version is still in the future (later than tomorrow in UTC), because a tick then would be older than a row another device makes on the day itself. Ticking works on a day this device hasn't made yet: the derived ID converges with another device's row.
- **What the statuses mean:** `open` is not ticked yet; for an *assumed* routine it means "taken as happening". `done` is ticked, by hand or from an entry (`raw_log_id`). `skipped` is didn't happen, or an entry said so.
- **Deleting a routine** soft-deletes the routine only. Its days stay as history; day lists join live routines, so they drop out.
- **The repeat engine moves to `@avchetan/shared`**, so the routines repository in `@avchetan/db` can check rules and work out days (`db` may not import `core`). It is pure date code with no platform imports. Rules arriving through sync are checked with `repeatRuleSchema`, and window times as `HH:MM`, like ones typed in.

## Alternatives considered
- **Rows only when something happens** (a tick or a skip), with open days worked out from the rules when read. There would be no made rows to conflict with, but nothing would record which routines were due on a past day: editing or pausing a rule would rewrite history, and the brief couldn't say what was missed.
- **Made rows stamped with `clock.now()`**, like any write. This gives the lost-tick case above.
- **Merging day status specially in sync** ("done beats open"). It would be the only table with its own merge rule in an otherwise uniform LWW protocol, on both clients and the server.
- **Making days ahead** (the week or month in advance). It brings rows for days that may never come, rule edits that leave stale future rows, and the same version problem one step further out.

## Consequences
- A day is recorded only if some device opened the app on it, which matches "never backfilled". The brief and day coverage read only days that have rows.
- `madeDayVersion` is the one deliberate exception to "timestamps come from `clock.now()`". Like a derived ID, it is computed from the row's own data so every device writes the same thing.
- Editing a rule doesn't touch days already made; today's row stays even if the new rule wouldn't fall on today.
- A rule from a newer app with a field this app doesn't know fails `repeatRuleSchema` (strict), so the server rejects the row as `validation`, and a client skips it when reading (`routineRule` returns null). Update every app before using a new rule field, as with other synced fields ([sync protocol](../architecture/sync-protocol.md#schema-evolution)).
