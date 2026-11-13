# Finding and using your data (v0.4.0)

> **Status: planned 2026-11-10** ([roadmap Phase 8](../roadmap.md#phase-8--finding-and-using-data-v040)). Decided one question at a time from the [feature audit](feature-audit-2026-11.md#gaps-and-ideas-for-discussion) ideas ([Q27](../open-questions.md)) and the user's own findings. The capture box work in the same release has its own spec: [capture box redesign](capture-box-redesign.md).

## Why

Everything Avchetan organizes can only be found today through Ask, which needs a model and takes up to 100 s on a processor. Tags and projects can be renamed but don't show their entries, and the numbers the AI extracts (distances, minutes, weights) are never shown over time. This release makes the data you already have findable and useful, with no AI and no network needed.

## What's in it

| # | Item | Where |
|---|---|---|
| 1 | [Plain search](#1-plain-search) | PC and phone |
| 2 | [Tag and project pages](#2-tag-and-project-pages) | PC and phone |
| 3 | [Editing an activity's numbers](#3-editing-an-activitys-numbers) | PC and phone |
| 4 | [Trends](#4-trends) | PC and phone |
| 5 | [Hub-unreachable warning](#5-hub-unreachable-warning) | PC and phone |
| 6 | [Grouped More menu](#6-grouped-more-menu-phone) | Phone |
| 7 | [Performance baseline](#7-performance-baseline) | Both, dev only |
| 8 | [Battery check](#8-battery-check-phone) | Phone |

## 1. Plain search

**What it finds:** the words you typed, instantly, on this device, with no AI. A local full-text index over entries, task titles and people's names ([ADR-0029](../decisions/0029-local-search-index.md)). Partial words match from the start (`dent` finds *dentist*).

**Similar entries from the hub:** when the device syncs with a hub or server that has search on, a second section, **Similar entries**, adds its meaning matches (`POST /v1/search`, [retrieval](../architecture/retrieval.md)). It loads after the word results and never holds them up. Offline, or in Standalone, the section isn't shown.

**Results**, grouped:
- **Entries:** date, the entry text with matching words highlighted, tags and category. Clicking one opens its day on Days with the entry in view.
- **Tasks:** title, due date, open or done. Clicking opens Tasks.
- **People:** name and last seen. Clicking opens the person's page.

**Filters:** date range (any time, this week, this month, this year, custom), tag, category, project, person. Filters apply to both sections. An entry matches a tag, category, project or person when it or anything organized from it has it; a task's date is its due date, or the day it was made. People aren't filtered, so the People group is hidden while a filter is on (built 2026-11-13). *Similar entries* lists only close matches ([retrieval](../architecture/retrieval.md#search-api)).

**Private entries** show only while the app is unlocked, as everywhere else. Locked, they're left out of the results (not shown as hidden).

**Opening it:**
- PC: a **Search** page in the main window's sidebar; **Ctrl+F** anywhere in the main window opens it; `/find words` in the capture box shows the first results right there ([capture box redesign](capture-box-redesign.md#find-in-the-capture-box)).
- Phone: a search icon at the top of the Days and Tasks tabs.

## 2. Tag and project pages

Clicking a tag (on the Tags page, or a tag chip on Days) or a project (Projects page) opens its page:

- **Header:** name, colour, number of entries, open tasks, first and last used, and totals of its numbers this month and all time (for example *running: 42 km this month · 318 km in all*), top three metrics only.
- **Open tasks** with that tag or project.
- **Entries by day**, newest first, using the same rows as Days, loaded as you scroll.
- A tag page includes its child tags (`#health` shows `#health/knee`), as private tags do.

The phone gets the same page; Tags and Projects move into the phone's More menu ([item 6](#6-grouped-more-menu-phone)).

## 3. Editing an activity's numbers

Numbers are shown on activities but can't be changed. CPU models sometimes drop them ("took 40 minutes" lost its number in the audit), and trends need them right.

- PC: on a Days activity row, **Edit numbers**. Phone: on the entry page, tap the numbers line.
- Each number is a row: a name chosen from the [metric registry](../architecture/data-model.md#metric-key-registry) (shown in words, *Duration*, with the unit) and a value. Add, change or remove rows.
- Typed units are converted for storage (5 mi → 8.05 km), the same way the normalizer does.
- Saving goes through the activities repository, sets *edited by you*, and becomes a correction example like other fixes ([ADR-0027](../decisions/0027-corrections-from-synced-edits.md)), so the model learns to keep numbers.

## 4. Trends

A **Trends** page (PC sidebar; phone More → Your stuff).

- **Pick a metric** from the ones that appear in your data (e.g. distance, sleep, weight), optionally narrowed to a category or tag.
- **Range:** 4 weeks, 3 months or 1 year. Bars per day for 4 weeks, per week for 3 months, per month for a year.
- **Each metric is summed or averaged**, as the registry says: durations, distances and counts add up; weight, sleep hours and scores are averaged. A new `aggregate` field in the registry holds this.
- A bar with no data is empty, not zero. Below the chart: the range's total or average and the change against the range before.
- **Click a bar** to list its activities underneath; each opens its day.
- Charts are hand-drawn SVG: the bucketing and axis maths live in `packages/core` and are tested once; each app has a thin renderer (`react-native-svg` on the phone). No chart library.

## 5. Hub-unreachable warning

Today a device that can't reach its hub queues entries silently; Days shows *Pending*.

- When a device that syncs with a hub or server hasn't synced successfully for **24 hours** and has entries waiting to send, Days shows a banner: *Not synced with your hub since Mon, 9 Nov — 12 entries waiting.*
- It names the likely fixes (the hub PC is on and Avchetan is running; same Wi-Fi or Tailscale on) and links to [troubleshooting](../user-guide/troubleshooting.md#server_unreachable).
- Both must hold: the **oldest waiting entry** has waited 24 hours **and** no sync worked in those 24 hours. A phone left unused for days then doesn't warn the moment a new entry is added, before its first sync could try. A device that never synced warns once its entries have waited a day.
- It clears itself after the next successful sync. No system notifications. The PC's banner has **Sync now**; on the phone, pulling Days down syncs.
- Uses the existing `lastSyncedAt` ([setup check](../user-guide/troubleshooting.md)); Standalone devices never show it.

## 6. Grouped More menu (phone)

The More tab is one flat list of 13 items, and this release adds four pages. Grouped with headings:

| Group | Items |
|---|---|
| **Your stuff** | People, Tags, Projects, Trends |
| **AI and capture** | AI models, Voice, Daily brief, What Avchetan learned |
| **Privacy** | App lock, Private tags |
| **Connection and data** | Sync, Your data, Setup check |
| **Help** | User guide, Report a problem, Run setup again |

## 7. Performance baseline

Before search is built, measure with a large made-up history so the index and pages are sized for years of use, not a week.

- A dev script fills the **demo** data folder (never the real one) with about 50,000 made-up entries over three years, with activities, tasks, tags, people and metrics.
- Measured and recorded in the roadmap: shortcut → capture box ready to type; main window start; Days, Tasks and People load; a search; sync of a 500-entry batch; the hub's memory use; database size.
- Targets: capture box ready < 150 ms; search < 100 ms; a page load < 200 ms. Only items far off the target are fixed in this release; the rest are noted.

## 8. Battery check (phone)

The phone already does little in the background: Android runs one task at most every 15 minutes, at times it chooses, which organizes up to 3 entries and syncs (`apps/mobile/src/services/background.ts`). No foreground service, no wakelock, no polling while closed.

- Measure over two days of normal use with Android's battery usage screen and `adb shell dumpsys batterystats`, and record the result.
- If the task shows a real cost: skip the run when nothing waits to be organized or sent, and pull at most hourly in the background.

## 9. Added after the baseline

Decided 2026-11-11, after the [performance baseline](../roadmap.md#phase-8--finding-and-using-data-v040) and the user's own observations:

- **Overdue tasks collapse:** on today in Days, overdue tasks are one line, **▸ 7 overdue** in the danger colour, closed by default; the app remembers whether it was left open. Both apps.
- **Pull-to-refresh** on the phone's Days syncs now.
- **Settings tabs** on the PC sit on one line across the page (scrolling sideways when the window is narrow); only the fields keep a narrow column.
- **Show more:** long lists (Tasks, People, a person's entries, tag and project pages, search results) show 50 rows, then **Show more**. No page numbers.
- **The People page** reads its summary with one join instead of a query with every mentioned entry's ID (346 ms with 50,000 entries).
- **Keys in the main window:** ← / → the day before and after, **T** today, **Ctrl+F** search, **?** a sheet of the keys. Not while typing in a field.
- **Empty pages teach:** a page with nothing yet says what fills it, with an example (*Log "ran 5 km" and your distance shows here*).
- **A phone's first download of a large history** doesn't freeze it: pulled pages are applied in small transactions that let the screen respond, with *Downloading your history… 12,000 of 50,000*.

## Not in this release

- Reminders at a time and repeating tasks: v0.5.0 ([Q28](../open-questions.md)).
- Encrypted hub traffic on home Wi-Fi and database encryption: v0.6.0 ([Q29](../open-questions.md), [Q6](../open-questions.md)).
- Search inside the phone's capture screen; saved searches; pinned trend cards on Review.

## Done when

- Search finds a word in 50,000 made-up entries in under 100 ms on the PC and phone, including Hindi in Devanagari, and shows hub matches when a hub is reachable.
- Tag and project pages list their entries and totals on both apps.
- An edited number shows on Days, in trends and in the correction list, and syncs to the other device.
- Trends show the right sums and averages for a test month (unit tests on the bucketing).
- The banner appears after 24 hours without sync with entries waiting, and clears after a sync.
- The phone's More tab is grouped; the battery result and performance baseline are recorded.
- The user guide covers search, tag and project pages, editing numbers, trends and the warning.
