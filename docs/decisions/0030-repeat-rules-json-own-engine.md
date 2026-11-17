# 0030 — Repeat rules are a Zod-checked JSON object, computed by our own code

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** [R25](../open-questions.md#resolved) (full calendar repeat rules), [tasks, routines and reminders §2](../product/tasks-routines-reminders.md#2-repeat-rules)

## Context
Routines (Day 4) and repeating tasks (Day 8) share one repeat system with full calendar rules: daily or every N days, weekly on chosen days, monthly on a day number or a weekday position, yearly, and an optional end (a date or a count). Rules are synced between devices, so the stored form has to be checked at the sync boundary and read the same on every device. Two choices were open: how a rule is stored, and what works out its dates.

Every rule here is about **local calendar dates** (`YYYY-MM-DD`). A routine's time window (22:30–06:00) and a reminder's time are separate fields, not part of the rule.

## Decision
- **Stored as a small JSON object** checked by `repeatRuleSchema` (Zod, `.strict()`), with fields named after RFC 5545 `RRULE` parts: `freq`, `interval`, `start` (`DTSTART`), `byWeekday` (weekly `BYDAY`), `byMonthDay`, `byNthWeekday` (`BYDAY=2TU`, `-1FR`), `byMonth`, `until`, `count`. The checks reject fields that don't belong to the frequency, both `until` and `count`, both a month day and a weekday position, and an end before the start. Not free `RRULE` text: that would need a parser, and many valid RRULEs (hourly, `BYSETPOS` combinations) mean nothing to a daily routine.
- **Computed by our own code** in `packages/core/src/repeat/`, moved to `packages/shared/src/repeat-rule.ts` on Day 4 so the routines repository can use it ([ADR-0031](0031-routine-days-derived-rows.md)) (decided with the user on 2026-11-17): `occurrencesBetween`, `nextOccurrence`, `isOccurrence`, `describeRepeatRule` (plain words for the apps) and `toRRule` (RFC 5545 text for export and to check the mapping). No new dependency, and no platform code.
- **No time zones in the engine.** The caller works out today with `localDate(clock.now(), zone)` and passes dates in, as it already does for due dates.
- Behaviour where it differs from RFC 5545, chosen to match how people read a rule:
  - A day number the month doesn't have uses the month's **last day** (the 31st → 30 April, 28 or 29 February; 29 February yearly → 28 February). RRULE would skip those months; `toRRule` writes it as `BYMONTHDAY=28,…,31;BYSETPOS=-1`, which means the same.
  - A **5th weekday** a month doesn't have is skipped, as in RRULE.
  - `start` is the first day the rule **can** fall on, not always an occurrence: a weekly rule on Mondays started on a Thursday begins the next Monday. RRULE counts `DTSTART` as an occurrence even when it doesn't match. `count` counts only matching days.
  - Weeks start on Monday (`WKST=MO`), like `weekOf` and the weekly review; "every 2 weeks" counts from the start's week.

## Alternatives considered
- **`rrule` (BSD-3-Clause):** full RFC 5545, but unchanged since 2023, and it works on JS `Date`s in UTC or a zone, which is where its known off-by-one-day bugs come from. We'd wrap it to get dates back and still have to test the edges ourselves.
- **`rrule-temporal` (MIT):** maintained and modern, but needs the Temporal API, which Hermes (the phone's JavaScript engine) doesn't have, so it brings a large polyfill into the app.
- **Free RRULE text in the database:** compact and standard, but parsing and validating arbitrary RRULEs is more work than our four frequencies need, and a bad string from sync is harder to reject clearly.

## Consequences
- Under 400 lines of code to own (with the words and RRULE text), covered by unit tests for month ends, leap years, weekday positions, every-N periods, ends, far-ahead windows (jumping ahead must match walking from the start) and the zone-free design.
- A rule's dates are worked out from the start each time; with a `count`, earlier days are walked to count them (at most 10,000). Without one, a far window jumps straight to its period.
- Because the fields map to RRULE terms, a library could replace the engine later, and rules can be exported as RRULE text (for example to a calendar) with `toRRule`.
- Routines (Day 4) store the rule as JSON text in SQLite and `jsonb` in Postgres, validated with `repeatRuleSchema` in the repository and in the sync payload.
