# Tasks, routines and reminders (v0.5.0)

> **Status: planned 2026-11-16** ([roadmap v0.5.0](../roadmap.md#v050--tasks-routines-and-reminders)). The ideas were collected on 2026-11-10, 2026-11-11 and 2026-11-15. The open decisions ([Q28](../open-questions.md#resolved), now R25) were made one at a time on 2026-11-16. Each day below is its own branch and pull request.

## Why

Today a task is either open or done, nothing reminds you of it, and anything you do regularly has to be typed in again each time. This release lets you say how a task went, move it or cancel it, set regular routines and chores, and get reminded at a time. The daily brief can then say what went well and what needs attention. All of it works offline in Home Hub mode with Ollama.

## What's in it

| Day | Item | Where |
|---|---|---|
| 1 | [Task fields](#1-finishing-a-task): done with a note, partly done, cancelled | Data + sync |
| 2 | [Task actions](#1-finishing-a-task): move, cancel, swipe, undo message | PC and phone |
| 3 | [Repeat rules engine](#2-repeat-rules) and its ADR | `packages/core` |
| 4 | [Routines table](#3-routines) and the days of a routine | Data + sync |
| 5 | [Routines page and starter list](#3-routines) | PC and phone |
| 6 | [Chore checklist card and evening notification](#4-confirming-chores) | PC and phone |
| 7 | [Chores ticked from entries](#5-chores-ticked-from-entries) | Extraction |
| 8 | [Repeating tasks](#6-repeating-tasks) through routines | PC and phone |
| 9 | [Reminders](#7-reminders): phone alarms, the per-device ring setting, PC popup | Phone first, PC |
| 10 | ["Remind me at 4" read by extraction](#8-reminders-from-what-you-type) | Extraction |
| 11 | [Sleep hours](#9-sleep-hours): stated times, *woke up*, bed + wake into `sleep_h` | Extraction + Trends |
| 12 | [The brief: Went well / Needs attention](#10-the-brief-went-well-and-needs-attention) | Brief |
| 13 | [Day coverage](#11-day-coverage) (opt-in) | Days |
| 14 | [Share to Avchetan](#12-share-to-avchetan) | Phone |
| 15 | [Accessibility pass](#13-accessibility-pass) | PC and phone |
| 16 | [`/done` and `/undo` on the phone](#14-done-and-undo-on-the-phone) | Phone |
| 17 | Test build and release ([releasing](../conventions/releasing.md)) | Both |

## 1. Finishing a task

Every task row, on both apps, offers:
- **Done**, with an optional note on how it went (`completion_note`).
- **Partly done**, with a percentage (`progress_pct`, 1–99). The task stays open.
- **Move**: *Tomorrow* · *Next week* · *Pick a date…*. This changes `due_date`.
- **Cancel** (`cancelled_at`): the task is shown struck through and is never counted as missed. **Delete** is still there for "this wasn't a task".

*Ahead* or *behind* is computed in code from `completed_at` and `due_date` ("2 days late"); it isn't stored.

Deleting a task in the main window shows an undo message instead of asking *Are you sure?*. On the phone, swiping a task row right marks it done and swiping left moves it to tomorrow.

**Built (Day 2, 2026-11-17):** *Next week* is the Monday after this week (`moveDates`). The Tasks page's last group is called *Done or cancelled*. Undo waits 10 seconds, like `/undo` in the capture box: a delete is only written when the time is up, so undoing it writes nothing. The phone shows the same undo message for deletes and for both swipes; the swipes are also screen-reader actions. Ahead or behind shows as *Done 2 days late* (`finishedDaysLate`, `formatTiming`).

**Data (Day 1):** `tasks` gets `completion_note`, `progress_pct` and `cancelled_at`, in both dialects with a migration each, through the repository and sync like every other task field. Reads that count open or missed tasks leave cancelled ones out.

## 2. Repeat rules

Routines and repeating tasks share **one repeat system**. It supports full calendar rules:
- daily, or every N days
- weekly on chosen days (every N weeks)
- monthly on a day number (the 31st falls back to the month's last day), or on a weekday position ("2nd Tuesday", "last Friday")
- yearly
- optional end: until a date, or after a count

Rules are computed in `packages/core` with no platform code. Calendar dates are local `YYYY-MM-DD`. Unit tests cover month ends, leap years and time-zone days.

**Decided in [ADR-0030](../decisions/0030-repeat-rules-json-own-engine.md) (Day 3, 2026-11-17):** a rule is a small Zod-checked JSON object whose fields map to RFC 5545 `RRULE` terms (not free RRULE text), and our own code in `packages/core/src/repeat/` works out its dates, with no new dependency. A rule's `start` is the first day it can fall on; a day number a month doesn't have uses its last day; a missing 5th weekday is skipped. `describeRepeatRule` gives it in words (*Every 2 weeks on Mon, Thu*), and `toRRule` as RRULE text.

## 3. Routines

A new synced `routines` table: title, repeat rule, optional time window (for example 22:30–06:00), optional category or tag, and a kind:
- **assumed**: sleep or work hours. They count as happening unless an entry says otherwise.
- **confirm**: chores such as a walk or watering the plants. You tick them off.

Each day of a routine is one row whose ID is derived from the routine and the date (`derivedId`), so two devices make it once and retries converge. Days are only made from today on, never backfilled.

**Routines page (Day 5)**, on both apps: a list with add, edit, pause and delete (soft delete). On first open the page offers a **starter list** to pick from. Nothing is added until you tick an item, and each starter's ID is derived from its key, so two devices don't add it twice:
- *confirm:* drink water, walk or exercise, take medicine, tidy up, water plants, read, plan tomorrow, sleep by a set time
- *assumed:* sleep, work hours

## 4. Confirming chores

There is **one checklist card** on Today (Days) listing the day's *confirm* chores, with a tick for each. There is **one evening notification** on the phone if anything is still unticked, never one per chore. It comes at 20:00 by default; this is a setting on each device, and only the devices set to ring use it (see [Reminders](#7-reminders)). Tapping the notification opens Today.

## 5. Chores ticked from entries

Extraction is given the titles of today's open chores and can name the one an entry matches. The code checks that the name really is an open chore today, ticks it, and shows **✓ Water plants (from your entry)** with an undo. This needs a new prompt version with fixtures, and it works with Ollama offline. A private entry is matched only by a local model, as everything private is. The AI suggests the match; only code writes it.

## 6. Repeating tasks

A task can have a repeat rule from §2. It is stored as a routine of a third kind, **task**. When a repeating task is finished or cancelled, the next one is made with a derived ID (routine + date), so two devices make it once. Moving one occurrence doesn't change the rule.

## 7. Reminders

A task can have a reminder time (`remind_at`), set by hand on both apps or [from what you type](#8-reminders-from-what-you-type).

- **Which devices ring:** a setting on each device, *Ring for reminders on this device*. It is not synced. It's on by default on the phone and off on the PC. When it's on, the PC shows a Windows notification while the app is running.
- **Phone:** reminders are scheduled with Android's alarm system as local notifications (as the [brief reminder](daily-brief.md#reminders) is), so nothing waits in the background. By default a reminder may come a few minutes late, which needs no extra permission. The setting *Ring at the exact minute* asks for Android's *Alarms & reminders* permission when you turn it on. If you refuse, it stays off, with a fix and a guide link.
- Finishing, cancelling or moving a task updates its scheduled notification. Reminders that arrive through sync are scheduled after sync.

## 8. Reminders from what you type

"Remind me at 4 pm to call the dentist" becomes a task with `due_date` today and `remind_at` 16:00 local time. The model gives a local time and code turns it into UTC. This is a new prompt version with fixtures, and it shares Day 11's time reading.

## 9. Sleep hours

Extraction stores when an activity happened in `occurred_at`:
- a stated time ("woke up at 6:05")
- the saved time when the words say it is happening now or just happened ("now going to sleep", but not "ran this morning")

*Woke up* always becomes an activity. A night's sleep is paired from going to bed and waking up into the `sleep_h` metric, which shows in [Trends](finding-and-using-data.md#4-trends). An *assumed* sleep routine fills nights with no entries only for [day coverage](#11-day-coverage), never as a metric.

## 10. The brief: Went well and Needs attention

The brief's first two lines are **✓ Went well** and **! Needs attention**, each with a mark and a colour. They replace *Moved forward* and *Friction*. *Needs attention* includes what was missed: tasks due and not done, tasks only partly done, chores not ticked, and assumed routines an entry contradicts. Cancelled tasks are left out. All of this is computed in code like the brief's other facts; the AI only phrases it. There is no schema change.

## 11. Day coverage

This is a setting, off by default. It shows the hours accounted for out of 24: logged `duration_min`, plus assumed routines (sleep, work) on days with no entry that contradicts them, plus 15% of the day for small things nobody logs. The rest is shown as **unaccounted**, never *wasted*, because an unlogged hour may have been rest.

## 12. Share to Avchetan

Android's share sheet sends text or a link from any app into a capture. This is a local capture like any other, and it never waits on the network.

## 13. Accessibility pass

On both apps: text size follows the system setting, keyboard focus is always visible, and controls have screen-reader labels. This includes the new task actions and the checklist card.

## 14. `/done` and `/undo` on the phone

The phone's capture box gets `/done` and `/undo`, reusing the fuzzy command matching from v0.4.0 ([capture box redesign](capture-box-redesign.md)).
