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
| 5 | Test tools and safety nets: engine tests, unknown values, repository invariants, migrating a database with rows ([roadmap](../roadmap.md#v050--tasks-routines-and-reminders), [R28](../open-questions.md#resolved)) | Tests |
| 6 | Sync keeps working on enum values and repeat-rule fields it doesn't know ([R27](../open-questions.md#resolved)) | Sync + server |
| 7 | Sync safety: keep the server ID, one-transaction server switch, rejected rows, strict IPv4 | Sync |
| 8 | Security hardening: token rotation, request limits, SQLite defensive mode, IPC inputs | Server + PC |
| 9 | Bug fixes: Ask dates and totals, weekly review, date slips | Core + db |
| 10 | Bug fixes: dock command race, hub restore, voice, capture errors | PC and phone |
| 11 | Log files on the PC and phone, CI audits and pins | Both + CI |
| 12 | [Routines page and starter list](#3-routines) | PC and phone |
| 13 | [Chore checklist card and evening notification](#4-confirming-chores) | PC and phone |
| 14 | [Chores ticked from entries](#5-chores-ticked-from-entries) | Extraction |
| 15 | [Repeating tasks](#6-repeating-tasks) through routines | PC and phone |
| 16 | [Reminders](#7-reminders): phone alarms, the per-device ring setting, PC popup | Phone first, PC |
| 17 | ["Remind me at 4" read by extraction](#8-reminders-from-what-you-type) | Extraction |
| 18 | [The phone reaches the hub directly on a hotspot](#15-the-phone-reaches-the-hub-directly-on-a-hotspot), without Tailscale | Sync, both |
| 19 | [Sleep hours](#9-sleep-hours): stated times, *woke up*, bed + wake into `sleep_h` | Extraction + Trends |
| 20 | [The brief: Went well / Needs attention](#10-the-brief-went-well-and-needs-attention) | Brief |
| 21 | [Day coverage](#11-day-coverage) (opt-in) | Days |
| 22 | [Share to Avchetan](#12-share-to-avchetan) | Phone |
| 23 | [Accessibility pass](#13-accessibility-pass) | PC and phone |
| 24 | `HubClient` in core: Ask, the brief and command reading leave the apps ([roadmap](../roadmap.md#v050--tasks-routines-and-reminders)) | `packages/core`, both apps |
| 25 | Command handlers, one undo model and the write actions move into core | `packages/core`, both apps |
| 26 | [`/done` and `/undo` on the phone](#14-done-and-undo-on-the-phone) | Phone |
| 27 | Edits made on two devices: keep the losing version ([roadmap](../roadmap.md#v050--tasks-routines-and-reminders)) | Sync, both |
| 28 | Test build and release ([releasing](../conventions/releasing.md)) | Both |

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

**Decided in [ADR-0030](../decisions/0030-repeat-rules-json-own-engine.md) (Day 3, 2026-11-17):** a rule is a small Zod-checked JSON object whose fields map to RFC 5545 `RRULE` terms (not free RRULE text), and our own code in `packages/shared/src/repeat-rule.ts` works out its dates, with no new dependency. A rule's `start` is the first day it can fall on; a day number a month doesn't have uses its last day; a missing 5th weekday is skipped. `describeRepeatRule` gives it in words (*Every 2 weeks on Mon, Thu*), and `toRRule` as RRULE text.

## 3. Routines

A new synced `routines` table: title, repeat rule, optional time window (for example 22:30–06:00), optional category or tag, and a kind:
- **assumed**: sleep or work hours. They count as happening unless an entry says otherwise.
- **confirm**: chores such as a walk or watering the plants. You tick them off.

Each day of a routine is one row whose ID is derived from the routine and the date (`derivedId`), so two devices make it once and retries converge. Days are only made from today on, never backfilled.

**Decided in [ADR-0031](../decisions/0031-routine-days-derived-rows.md) (Day 4, 2026-11-17):** days live in a second table, `routine_days`, with a status (`open`, `done`, `skipped`). A day is made when an app opens on that day. A newly made day carries a fixed early version (midnight UTC the day before), so a tick on one device is never undone when another device makes the same day later.

**Routines page (built on Day 12, 2026-11-19)**, on both apps (PC: **Routines** in the main window; phone: **More → Routines**): a list with add, edit, pause and delete (soft delete). On first open the page offers a **starter list** to pick from. Nothing is added until you tick an item, and each starter's ID is derived from its key, so two devices don't add it twice:
- *confirm:* drink water, walk or exercise, take medicine, tidy up, water plants, read, plan tomorrow, sleep by a set time
- *assumed:* sleep, work hours

## 4. Confirming chores

There is **one checklist card** on Today (Days) listing the day's *confirm* chores, with a tick for each. There is **one evening notification** on the phone if anything is still unticked, never one per chore. It comes at 20:00 by default; this is a setting on each device, and only the devices set to ring use it (see [Reminders](#7-reminders)). Tapping the notification opens Today.

**Built on Day 13 (2026-11-20).** The card is on Days on both apps (*Chores · 2 of 5*, a tick each; assumed routines are not listed, skipped chores show as skipped). Since Day 16 it is sent only when the phone rings for reminders (§7). The evening notification is a phone-only setting under **More → Routines** (*Remind me about chores left*, on at 20:00, kept per device). It is planned by `planChoreEvening` in `packages/core` and rescheduled after every write, every sync and when a new day's chores are made, so a chore ticked on the PC takes it back once the phone has synced.

## 5. Chores ticked from entries

Extraction is given the titles of today's open chores and can name the one an entry matches. The code checks that the name really is an open chore today, ticks it, and shows **✓ Water plants (from your entry)** with an undo. This needs a new prompt version with fixtures, and it works with Ollama offline. A private entry is matched only by a local model, as everything private is. The AI suggests the match; only code writes it.

**Built on Day 14 (2026-11-20).** Prompt `extraction.v6` gets an *Open chores today* line (only on a day with open chores) and answers `choresDone` with titles from it. Code keeps a name only if it is one of the chores offered (case and punctuation aside) and the entry also has an activity on that day, so a plan (*need to water the plants*) or another day (*yesterday*) ticks nothing. It ticks only a day nobody has touched since it was made (`routines.tickFromEntry`): a chore someone ticked, skipped or unticked stays as they left it, so processing the entry again never redoes an undo. The card shows *from your entry* beside such a chore, with **Undo**. Eval on five made-up chore fixtures: `granite4.2:3b` 3/5, `granite4.2:8b` 4/5; both missed *read 20 pages* for a chore named *Read*, which only leaves it unticked.

## 6. Repeating tasks

A task can have a repeat rule from §2. It is stored as a routine of a third kind, **task**. When a repeating task is finished or cancelled, the next one is made with a derived ID (routine + date), so two devices make it once. Moving one occurrence doesn't change the rule.

**Built on Day 15 (2026-11-20).** `tasks` gained `routine_id` and `routine_date` (the occurrence a task stands for; migrations sqlite `0007`, pg `0011`). **Repeat…** on a task (both apps, the rule form from the Routines page) makes a `task` routine and the task its first occurrence: it keeps its due date, or gets the first occurrence from today. `tasks.complete` and `tasks.cancel` now take the user's local `today` and make the next occurrence after `routine_date` but never before today, so a task finished weeks late adds one task, not a backlog. The next one's ID is `derivedId('repeat_task', routine, date)`; it isn't made when it already exists (another device, or deleted by the user), when the rule has ended or is paused, or after **Stop repeating** (the routine is deleted, the tasks stay). Reopening a task leaves the next one. `task` routines don't appear on the Routines page; a task shows *↻ Every week on Monday*.

## 7. Reminders

A task can have a reminder time (`remind_at`), set by hand on both apps or [from what you type](#8-reminders-from-what-you-type).

- **Which devices ring:** a setting on each device, *Ring for reminders on this device*. It is not synced. It's on by default on the phone and off on the PC. When it's on, the PC shows a Windows notification while the app is running.
- **Phone:** reminders are scheduled with Android's alarm system as local notifications (as the [brief reminder](daily-brief.md#reminders) is), so nothing waits in the background. By default a reminder may come a few minutes late, which needs no extra permission. The setting *Ring at the exact minute* asks for Android's *Alarms & reminders* permission when you turn it on. If you refuse, it stays off, with a fix and a guide link.
- Finishing, cancelling or moving a task updates its scheduled notification. Reminders that arrive through sync are scheduled after sync.

**Built on Day 16 (2026-11-20).** `tasks.remind_at` (UTC instant; migrations sqlite `0008`, pg `0012`), set with `tasks.setReminder`. Moving a task moves the reminder by the same days, and a repeating task's next occurrence gets the same time of day. `tasks.reminders(after, limit)` lists open tasks' reminders still ahead; one from a private entry is titled *Reminder: a private task*, so no private title reaches a lock screen. The ring setting (`reminders.ring`, local) is planned in `packages/core/src/routines/reminders.ts`. **Phone:** More → Reminders; the next 50 reminders are handed to Android after every write, sync, new day and app start, changing only what differs (`services/task-reminders.ts`); the chore evening (§4) now also needs the phone to ring. *Ring at the exact minute* is Android's own *Alarms & reminders* permission (`SCHEDULE_EXACT_ALARM`, declared in `app.json`): expo-notifications uses exact alarms whenever it is granted, so the screen shows Android's answer rather than a stored switch. **PC:** Settings → General → Reminders; the dock checks every 30 s and shows a Windows notification (`reminder_notify`), at most an hour late after sleep or a restart, never twice (`reminders.shown_until`). Both apps: **Remind me** on a task, shown as *⏰ Today 16:00*. The PC uses its chosen time zone, the phone the system's.

## 8. Reminders from what you type

"Remind me at 4 pm to call the dentist" becomes a task with `due_date` today and `remind_at` 16:00 local time. The model gives a local time and code turns it into UTC. This is a new prompt version with fixtures, and it shares Day 11's time reading.

**Built on Day 17 (2026-11-20).** Prompt `extraction.v7` adds `remindAt` (local `HH:MM`) to each task, with two examples and a rule: only when the entry asks to be reminded, never for a time that is only part of a plan. Code (`plannedReminder` in `normalize.ts`) makes the instant on the task's day in the entry's time zone, uses today when the entry names no day (`namesNoDay`, as small models copy the examples' date), gives an undated task the reminder's day, and drops a time already past when written. Organizing again sets `remind_at` only on a task that has none. Eval on five made-up reminder fixtures: `granite4.2:8b` 4/5 (missed *kal subah 6 baje yaad dilana*), `granite4.2:3b` 2/5 before the no-day check; the whole set on `granite4.2:8b` 40/58, the 53 older fixtures 36/53, in line with earlier runs of this model on a processor.

## 9. Sleep hours

Extraction stores when an activity happened in `occurred_at`:
- a stated time ("woke up at 6:05")
- the saved time when the words say it is happening now or just happened ("now going to sleep", but not "ran this morning")

*Woke up* always becomes an activity. A night's sleep is paired from going to bed and waking up into the `sleep_h` metric, which shows in [Trends](finding-and-using-data.md#4-trends). An *assumed* sleep routine fills nights with no entries only for [day coverage](#11-day-coverage), never as a metric.

**Built on Day 19 (2026-11-21).** Prompt `extraction.v8` adds `occurredAt` (local `HH:MM`, or `"now"` when it is happening now or just ended) and `sleep` (`bed` / `wake`) to each activity, with two examples and rules: *woke up* is always an activity, going to sleep is never skipped. Code (`plannedOccurrence` in `normalize.ts`) makes `occurred_at` in the entry’s time zone, uses the save time for `"now"` on today only, and moves a stated time later than the entry to the night before. The mark is stored as the `sleep_event` metric (not shown). `pairSleep` (`packages/db`) puts the hours since the latest bed in the 16 hours before onto each wake-up with no `sleep_h`, so it counts for the day you woke and shows in Trends; under 2 hours is a nap, another wake-up in between owns the bed, hours the entry states are kept, a user-edited wake-up is never changed. Eval on seven made-up fixtures: `granite4.2:8b` 4/7 (missed *abhi so raha hoon*, a *slept ok* split into two activities, and a lost *30 min*); the whole set 47/65, the 58 older fixtures 43/58 (Day 17: 40/58).

**Since test build 1 (2026-11-24):** when the model gives no hours, code reads them from the entry's own words (`extraction/sleep-words.ts`: a range of times such as *from 10 PM to 6 AM* or *slept at 1:50 AM and woke up at 6:50 AM*, or *slept 7 hours*, only in a clause about sleep) and puts them on the wake-up, as pairing would. Pairing never overwrites hours already set.

## 10. The brief: Went well and Needs attention

The brief's first two lines are **✓ Went well** and **! Needs attention**, each with a mark and a colour. They replace *Moved forward* and *Friction*. *Needs attention* includes what was missed: tasks due and not done, tasks only partly done, chores not ticked, and assumed routines an entry contradicts. Cancelled tasks are left out. All of this is computed in code like the brief's other facts; the AI only phrases it. There is no schema change.

**Built on Day 20 (2026-11-21).** Prompt `daily-brief.v3`: the model writes `wentWell`, `needsAttention` (nullable) and `observation`; `collectBriefFacts` adds chores done and a *Missed* block (due and not done, partly done with the percentage, chores still open, assumed routines marked skipped), leaving out cancelled tasks, skipped chores and anything from a private entry when the model is in the cloud. *An assumed routine an entry contradicts* is a skipped day of it, set by hand from the checklist for now. The notes keep the same three-line shape, so briefs made before read as Went well and Needs attention. Both apps show the two lines with a coloured mark (✓ green, ! amber) and the name in words, and the rolled-over tasks under Needs attention.

## 11. Day coverage

This is a setting, off by default. It shows the hours accounted for out of 24: logged `duration_min`, plus assumed routines (sleep, work) on days with no entry that contradicts them, plus 15% of the day for small things nobody logs. The rest is shown as **unaccounted**, never *wasted*, because an unlogged hour may have been rest.

**Built on Day 22 (2026-11-23).** `dayCoverage` in `packages/core/src/routines/coverage.ts` works from the day's activities and routine days, in code (no AI). Logged = the sum of `duration_min`; logged sleep = `sleep_h` (on the wake-up, Day 19), and when there is any, an assumed sleep routine (the *Sleep* starter, or one with *sleep* in its name) is left out. Assumed routines count by their time window on the day's clock (*23:00–07:00* covers 00:00–07:00 and 23:00–24:00), overlaps once, a day marked skipped not at all; one without a window counts nothing. Small things = 15% of the period. The total never passes the period, so a duration logged inside work hours can count twice without overfilling the day. Today's period is the hours gone by, and windows count only up to now; days ahead show nothing. Days are 24 hours, also on daylight-saving days. The switch is the per-device setting `days.coverage` (not synced), on the Routines page of both apps; the card sits above Chores on Days.

## 12. Share to Avchetan

Android's share sheet sends text or a link from any app into a capture. This is a local capture like any other, and it never waits on the network. It is saved with the source `mobile_text`: a new source value would stop older apps from syncing ([R27](../open-questions.md#resolved)), so `mobile_share` waits for v0.6.0.

**Built on Day 23 (2026-11-23).** The author chose that a share *opens the capture box filled in*, rather than saving at once, so a note can be added. The app's activity takes `text/plain` `SEND` intents (`android.intentFilters` in `app.json`). A local Expo module (`apps/mobile/modules/share-intent`, Kotlin) hands the shared text and subject to JavaScript once: `takeShared()` at start, and an `onShare` event when the app was already open. A share reopened from Recents (`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`) is ignored, and a taken intent is cleared so a rotation doesn't open it twice. `draftWithShared` (`src/services/share.ts`) puts a subject the text doesn't already hold (a page's title) above the text (its link), keeps what was typed above that, and cuts at 20,000 characters. The capture screen opens with `?from=share` and, like the widget, sends the app to the background when closed, so you're back in the app you shared from. App lock still comes first. The log gets the length of what was shared, never the text.

## 13. Accessibility pass

On both apps: text size follows the system setting, keyboard focus is always visible, and controls have screen-reader labels. This includes the new task actions and the checklist card.

**Built on Day 24 (2026-11-23).** An audit of every control in both apps (2,542 JSX elements, read with a parser: phone `Pressable` without a role, or with neither a label nor `Text` inside, `Switch` and `TextInput` without a label; PC buttons with no words and no `aria-label`, fields without a label) found one real gap: the phone's pick sheet backdrop had a label but no role, and its inner sheet was an unnamed pressable (now `accessible={false}`). The task actions, swipes (already in `accessibilityActions`), the chore card and the coverage card were in order. **Text size:** the phone already followed Android (nothing turns `allowFontScaling` off; the few fixed widths wrap or hold icons). WebView2 doesn't apply Windows' Text size, so the PC asks Windows (`text_scale`, `UISettings.TextScaleFactor`, `src-tauri/src/text_scale.rs`) at start and whenever a window comes to the front, and sets the root font size (`services/text-size.ts`); text and spacing are in `rem`, and the dock already fits its height to what it shows. **Focus:** one ring for every control on the PC (`:focus-visible`, 2 px accent, in Tailwind's base layer so the dock's text box keeps its own look). The [code-style convention](../conventions/code-style.md) now says all of this. The author chose to keep the audit: `pnpm a11y:check` (`tooling/scripts/check-a11y.ts`, in CI) reads the JSX with `@babel/parser` (a new dev dependency, MIT; TypeScript 7 has no parser API). On the phone, a component of ours or a bare `{children}` inside a pressable is taken as holding words, and a `Switch` hidden from screen readers inside a labelled row passes.

## 14. `/done` and `/undo` on the phone

The phone's capture box gets `/done` and `/undo`, reusing the fuzzy command matching from v0.4.0 ([capture box redesign](capture-box-redesign.md)). The handlers come from `packages/core` (Day 26), so the phone and the PC run the same code.

**Built on Day 27 (2026-11-23).** Typing `/` in the phone's capture box replaces **Save** with what the command will do (`src/ui/command-panel.tsx`): suggestions are `/done` and `/undo` only (core's fuzzy ranking, filtered), `/done` plans with core's `planSharedCommand`, several matches are a list to tap, and the result shows with **Undo** until the next keystroke. The undo list (`createUndoStack`, 20) lives in the phone's services for as long as the app runs; an entry saved from the box joins it (`rememberCapture`). Other commands say they are on the PC only for now, and an unknown one is not sent to the AI. `//` saves an entry starting with `/`. While locked, commands show **Unlock** first and no task titles. Planning is in `src/services/command-plan.ts` (tested without Expo).

## 15. The phone reaches the hub directly on a hotspot

*Added 2026-11-20 from what the author sees often:* the laptop running the hub is online through the phone's own hotspot, yet the phone reaches the hub through Tailscale. The two are on one small network (the phone is its router), so they could talk directly. They don't because (1) the phone only knows the addresses saved at pairing, and on the hotspot the laptop has another one (on many phones the hotspot's range changes each time it is turned on), and (2) Windows treats a newly joined network, such as a hotspot, as **Public**, and the guide's firewall rule allows the hub's port on **Private** networks only.

- **The hub tells the phone where it is.** Each sync answer (or the health check) carries the hub's current local addresses, as the pairing code does. The phone keeps them beside the paired ones and tries the local ones first, Tailscale after. The pinned server ID (Day 7) still has to match, so another device at that address is never used.
- **Setup check on the PC:** warns when the network the hub listens on is marked Public, with how to set it to Private (only for networks you own, such as your phone's hotspot).
- Works the same on home Wi-Fi when the router gives the PC a new address. Tailscale stays the way in from anywhere else.

**Built on Day 18, part 1 (2026-11-20).** The challenge ([ADR-0033](../decisions/0033-hub-proves-itself-before-the-token.md)): `/v1/health?challenge=` answers with `proof`, an HMAC keyed by the token's hash; `findServer` asks every saved and learned address at once and takes the first that is the expected server and proves itself; a saved address that fails the proof gets no token and sync says `unauthorized`. After a sync the device asks `/v1/pairing` for the hub's addresses (at most every 10 minutes) and keeps the ones the transport rules allow (`sync_state.learned_urls`). Ask, the brief, commands and search find the hub the same way (`connectHub`). So once the phone has synced with the PC on its hotspot (through Tailscale, say), the next syncs go straight to the PC's hotspot address, and a dead address no longer costs 4 s before the next. The *network is Public* warning was already on the PC's hub checklist. **Built on Day 18, part 2 (2026-11-20).** mDNS. **PC:** while the hub runs, the desktop app registers `Avchetan hub on <computer>._avchetan._tcp.local` with Windows' own mDNS responder (`DnsServiceRegister`, `src-tauri/src/mdns.rs`) and withdraws it when the hub stops; Windows answers for it, so the app opens no port of its own. A hub run from a terminal or in Docker doesn't announce itself. **Phone:** a local Expo module (`apps/mobile/modules/hub-discovery`, Kotlin, Android's `NsdManager`) looks for `_avchetan._tcp` for 3 s, only when no saved or learned address answered; each address found must pass the challenge, and one that does joins the learned addresses. No new Android permission. **To try on the author's phone:** whether Android's discovery sees a laptop on the phone's own hotspot (if not, the learned addresses of part 1 still cover it), and on home Wi-Fi.
