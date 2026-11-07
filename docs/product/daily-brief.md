# Daily brief

A short look back at one day, made by the analysis model in the evening and shown at the top of that day in the [Days view](days-view.md). It is the first item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence-) and replaces the outline in [advancements §2](advancements.md#daily-brief-phase-6).

## Why

Capture and organizing turn a day into rows, but nothing hands the day back. The brief answers "how did today go" in four lines, and turns forgotten open tasks into one-click decisions.

## What it looks like

At the top of a day in Days, in place of the summary line:

```
┌ Daily brief · made by your hub at 21:04 ───────────┐
│ • Moved forward: schema design, 2 workouts;         │
│   3 h 10 min of work logged.                        │
│ • Friction: shoulder pain (twice), low energy.      │
│ • 2 tasks rolled over:                              │
│     Send the invoice        [Move to tomorrow]      │
│     Call the plumber        [Move to tomorrow]      │
│ • Pain showed up on both workout days.              │
│                                    [Make it again]  │
└─────────────────────────────────────────────────────┘
```

- **Four bullets:** (1) what moved forward and the total time logged, (2) friction (pain, fatigue, blockers), (3) rolled-over tasks, (4) one observation or suggestion. A bullet with nothing to say is left out (no friction → no friction bullet).
- **Bullet 3 is built by the app, not the model:** the tasks that are still open and were due on that day or earlier, read live from `tasks`, each with **Move to tomorrow** (due date becomes the day after *today*). A task done or moved since disappears from the list. The model only gets the count.
- **Today**, before the brief exists: the summary line as now, plus **Make the brief now**.
- **A day without entries gets no brief** and costs no model call.
- **Make it again** replaces the brief, for example after entries were added late. Deleting a brief hides it, and the app does not make it again by itself.

## When and where it is made

| Device's answers setting (`analysis.mode`) | Who makes the brief |
|---|---|
| `self`, with an analysis model | This device, at the brief time |
| `hub` | The hub: on its own at the brief time, or right away when the device asks (opening Days, **Make the brief now**) |
| No model at all (Standalone without a model) | Nobody; Days keeps the summary line and says why, with a link to [AI models](../user-guide/ai-models.md) |

- **Brief time:** a device setting `brief.time`, default **21:00** local time, changed in Settings → Daily brief (desktop) and More → Daily brief (phone), together with `brief.enabled` (default on).
- **Due, not timed:** a device checks every few minutes, from saved state, whether a brief is due (the [background jobs](../patterns/background-jobs.md) pattern), so a PC that wakes at 22:30 still makes it. Due means: brief time has passed today, or it is yesterday's brief that was never made (a device asleep all evening, or Standalone with no server to fall back on). Older days are only made by hand.
- **Exactly once:** before calling the model, a device syncs (when it has a server) and looks for the brief's row. Its ID is `derivedId('daily-brief', date)`, so if two devices still both make it, the rows have the same ID and last-write-wins keeps one.
- **Server fallback:** the server's own device ([ADR-0022](../decisions/0022-hub-answers-on-its-device.md)) runs the same code. It makes the brief 30 minutes after the brief time (`BRIEF_GRACE_MINUTES`) if no device has, and right away when a device in `hub` mode asks (`POST /v1/brief`). It needs `ANALYSIS_PROVIDER`, like hub Ask. Devices report their time zone and brief time when they register and when either changes; the server uses the device seen most recently.
- **Privacy:** the same line as Ask. Private entries go into the brief only when the model runs on the same machine as the data (an Ollama model on this device, or on the hub for the hub's brief); otherwise they are left out.

## Reminders

- **Desktop:** a Windows notification "Your daily brief is ready" when this PC makes or receives today's brief; clicking it opens Days on that day. Uses Tauri's notification plugin.
- **Phone:** the app can't count on running at 21:00, so it schedules a local reminder instead (`expo-notifications`): "Your day in brief". Tapping it opens Days, which makes or fetches the brief then. The reminder is scheduled for a day only once that day has an entry, so empty days stay quiet. Android 13+ asks for permission: the app offers it once, on a card in Days ("Get a reminder at 21:00?"), and the setting can be changed later.

## How the brief is made

In `@avchetan/core` (`analysis/daily-brief.ts`), on a `ClientStore`, so the apps and the server's device share it:

1. **Facts in code** (models are bad at arithmetic, as in Ask): entries that day (`dayEntries`), activities by category with their main metric totals, total `duration_min`, tasks done, open tasks rolled over (count), friction tags (tags under `health/` and tags such as `pain`, `fatigue`, `blocked`, `low-energy` and their children), and the entries' text.
2. **One structured call** to the analysis model (`generateStructured`, no tools, so small CPU models manage it): a Zod schema with `movedForward`, `friction` (nullable) and `observation`, each one sentence. Prompt in `prompts/daily-brief.v1.ts`, an eval fixture set beside the extraction fixtures.
3. **Saved** through the activities repository: category `reflection`, `origin = 'system'`, `title = 'Daily brief'`, `notes` = the bullets as text, `metrics = { kind: 'daily_brief' }`, `logged_date` = the day, ID `derivedId('daily-brief', date)`. One `llm_runs` row with `purpose = 'analysis'`.

System rows are not entries: Days' dots and summary line, Ask's counting tools and the extraction vocabulary skip activities with `origin = 'system'`.

Errors use the existing LLM codes (`llm_auth`, `llm_no_credit`, `llm_rate_limited`, timeouts, …) and [error help](../user-guide/troubleshooting.md). A failed brief shows on the day as "Couldn't make the brief" with the help link and **Try again**; automatic tries wait like extraction retries.

## Data changes

- None on synced tables: the brief is an `activities` row, and `metrics.kind` is in the [registry](../architecture/data-model.md#metric-key-registry).
- Server-only `devices` gets `time_zone` and `brief_time` (nullable), with a migration; `POST /v1/devices/register` takes both as optional fields.
- Client settings `brief.enabled`, `brief.time`, and the phone's `brief.reminder`.

## Done when

- A day with entries gets one brief on the desktop at the brief time, on the phone when the reminder is tapped, and from the hub when no device made it.
- Two devices making the same day's brief end with one row after sync (test with two stores and the deterministic ID).
- **Move to tomorrow** moves a rolled-over task and it leaves the brief's list on every device.
- Private entries never reach a cloud model for a brief (fetch spy test, as for Ask).
- The [user guide](../user-guide/README.md) has a Daily brief page with the setting, reminders and errors.

## Not in this version

- A morning plan (Q11, resolved as R24: later, if the Days view's due and overdue tasks aren't enough).
- Weekly review (Phase 7).
- Choosing which device makes the brief by hand.
