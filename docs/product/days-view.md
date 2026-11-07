# Days view

The main way to look back at entries and ahead at tasks, one day at a time. It replaces the desktop **Timeline** page and the phone's **Today** tab ([roadmap: v0.2.0](../roadmap.md#v020--days-view-and-more-ai-providers-)).

## Why

The timeline is one endless list, loaded 50 entries at a time and grouped by the day an entry was typed. For someone who logs every day, a month back is hundreds of rows of scrolling, and the list has no sense of "what did that week look like". It also puts an entry under the wrong day when it talks about another one: "yesterday I ran 5 km", typed today, is listed under today, although its activity is dated yesterday.

## What it looks like

**Phone** (the first tab, named **Days**):

```
┌──────────────────────────────┐
│ Nov 2026              [Today]│   month and year; Today jumps back
│  S   M   T   W   T   F   S   │
│  1   2   3   4  (5)  6   7   │   week strip: swipe for the week before/after
│  ●   ●●  ●       ●●●         │   dots: up to 3 category colours
│ ─────── pull down ───────    │   pull down (or tap the month) for the whole month
│ Thursday, 5 November         │
│ 6 entries · Workout 45 min · │   summary line (later: the daily brief)
│ Diet 3 · 2 tasks done        │
│ Tasks: due today, done today │
│ Entries, by time             │
│                         (+)  │   capture button, as now
└──────────────────────────────┘
```

**Desktop** (the main window's first page, named **Days**): the selected day's week as a strip pinned to the top of the page with the same dots, ‹ and › for a week, and the day below it. Clicking the month and year (or M) drops the whole month down over the page; picking a day or Esc closes it. ← and → move a day, Page Up and Page Down a month, T goes to today. *Changed 2026-11-07: the month calendar used to sit on the left and scrolled away with a long day.* The capture dock is unchanged.

## Rules

- **Days are local dates** in the user's time zone setting ([time and IDs](../conventions/time-and-ids.md)). A day runs from midnight to midnight, as everywhere else in the app.
- **An entry belongs to the day it was typed, and to every day one of its activities is dated** (`activities.logged_date`). On that other day it is marked *added on 5 Nov*, so "yesterday I ran" shows on yesterday as well as today.
- **Tasks:** a day lists tasks due that day (open ones first) and tasks completed that day. Overdue open tasks show on today only, under *Overdue*, so they don't fill every past day.
- **Future days** show only their due tasks, so the calendar also works as a planner. Days without anything say so in one line.
- **The summary line** counts entries, adds each category's main metric when there is one (`duration_min`, `distance_km`, …, from the [metric registry](../architecture/data-model.md#metric-key-registry)), and counts finished tasks. When the daily brief arrives (Phase 6), it takes this place on the days that have one.
- **Dots:** one per category that has an activity that day, at most three (the categories with the most activities). A day with only unorganized entries gets a grey dot. No dot means nothing was logged.
- **Category colours:** a fixed palette of eight colours, each with a light-theme and a dark-theme value. A category with its own `color` uses it. Otherwise its slug picks one from the palette, so the same category has the same colour on every device without syncing anything. The palette lives in `@avchetan/shared` so both apps use it.
- **Pending and failed entries** show on their day like any other, with their status badge, as the timeline does now.
- **Opening the app** shows today. The app remembers the selected day only while it is open.

## Data access

No schema change. Two new read queries in `@avchetan/db` (both filter `deleted_at IS NULL`):

- `dayEntries(day, timeZone)`: raw logs whose `captured_at` falls in the day's UTC range (the existing `raw_logs_captured_at_idx`), plus raw logs that have an activity with `logged_date = day` (`activities_logged_date_idx`).
- `monthDots(firstDay, lastDay, timeZone)`: per day, the categories with activities (`logged_date` in range, grouped) and whether any raw log was captured that day without an activity. Raw logs are bucketed into local days in TypeScript from `captured_at` and `captured_tz`, at most a month (one query) at a time.

If phones with years of data make `monthDots` slow (target: under 50 ms for a month with 300 entries), a stored local `captured_date` on `raw_logs` can be added later, with its migration in both dialects.

## Not in this version

- Week and month summaries (Phase 7's weekly review will fit here).
- Moving an entry to another day by hand. Editing the entry's text ("yesterday" instead of "today") already re-dates its activities.
- Search inside the Days view. **Ask**, **Tags**, **Categories** and **Projects** cover finding by topic.
