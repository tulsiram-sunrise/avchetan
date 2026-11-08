# Weekly review

Each Sunday evening Avchetan looks back at the week, Monday to Sunday. A **Your week** card at the top of Sunday in [Days](days-view.md) shows the week in numbers, compares it with recent weeks, and lists 3 to 5 patterns, each with its numbers ("4 of 5 days with under 6.5 h sleep had *low energy* logged"). The app counts everything; the AI only puts the strongest patterns into words. This is item 3 of [Phase 7](../roadmap.md#phase-7--advancements-b-voice-graph-patterns-privacy), and it replaces the outline in [advancements §2](advancements.md#weekly-pattern-detection-phase-7).

## Why

The [daily brief](daily-brief.md) hands back one day. Patterns only show across days: sleep and energy, workouts and pain, a habit that slipped. People don't spot them in their own log, and a model asked to "find patterns" in raw entries invents them.

## Decisions (2026-11-08)

| Question | Decision |
|---|---|
| Where | A **Your week** card at the top of the week's Sunday in Days, under the daily brief, on both apps. Past weeks: go to their Sunday. A notification when it's ready. |
| When | **Sunday at the brief time** (21:00 by default), right after that day's brief. Weeks run Monday to Sunday. |
| Findings | **The app counts; the AI phrases.** The app computes every number and picks the candidate patterns; the AI writes 3 to 5 findings from them and may only use the app's numbers. A pattern on fewer than 3 days is never shown. |
| Thin weeks | **Totals only.** The card still shows the week in numbers and says *Not enough days yet to see patterns*. No AI call. |

## What it looks like

```
┌ Your week · 2–8 Nov ───────────────────────────────────────┐
│ 6 of 7 days logged · 4 workouts (3 h 10 min) · 9 tasks done │
│ vs your last 4 weeks: workouts ↑ 1 · work time ↓ 25%        │
│                                                             │
│ • On the 4 days with under 6.5 h sleep, you logged low      │
│   energy on 3; on the other 3 days, never.                  │
│ • Knee pain came up on 3 of your 4 run days, and on no      │
│   gym day.                                                  │
│ • 5 days of journaling in a row, your longest yet.          │
│                                            [Make it again]  │
└─────────────────────────────────────────────────────────────┘
```

- **Totals line** (always shown, read live, so a late entry or a ticked task updates it): days with an entry, activities by category with their main metric totals, total time logged, tasks done, promises kept ([people and promises](people-and-promises.md)).
- **Compared with recent weeks:** each total against the average of the previous 4 weeks that had entries. Only changes of at least 25% (or 1 for counts under 4) show, at most three.
- **Findings:** 3 to 5 bullets, saved when the review is made. **Make it again** redoes them, for example after late entries.
- **Thin week:** totals and comparison only, with *Not enough days yet to see patterns*. There is no **Make it again** until a pattern could exist.
- **Notification:** desktop "Your week in review is ready" (opens Sunday in Days). On the phone, Sunday's brief reminder reads "Your day and week in brief".

## How patterns are found

All in code, in `@avchetan/core` (`analysis/weekly-review.ts`), on a `ClientStore`, so the apps and the hub share it. Patterns use the **last 28 days** (this week and the three before it), because 7 days are too few to tell a pattern from chance. Each finding is about something that happened this week.

1. **Day facts.** For each of the 28 days: the categories of its activities, its tags (inferred and explicit, with their parents: `health/knee` counts as `health` too), friction tags (as in the [brief](daily-brief.md#how-the-brief-is-made)), 1–5 scales (`energy`, `mood`, `stress`), and numeric metrics (`sleep_h`, `duration_min`, `weight_body_kg`, …). Sleep belongs to the day it was logged (the morning after the night).
2. **Candidates**, each with its numbers and the days it rests on:
   - **Together:** a condition (a tag, a category, a metric below or above a threshold) and an outcome (a friction tag, or a 1–5 scale at 2 or below). Shown when the condition held on at least **3 days**, the outcome followed on at least **3** of them, and the outcome's rate differs from the other days by at least **40 percentage points**. Metric thresholds come from the registry, for example `sleep_h < 6.5` and `duration_min >= 30`, never from the model.
   - **Change:** a category's count or time, or a metric's average, this week against the previous 3 weeks. At least 25% and 3 data points on each side.
   - **Streak:** a category or tag on consecutive days, at least 4, noted when it's the longest in the 28 days.
3. **Ranked** by strength (how far apart the rates are, times how many days support it). The top 8 go to the model. With none, the week is thin: no AI call.

## How the review is made

1. **One structured call** to the analysis model (`generateStructured`, no tools, so small CPU models manage it). It gets the candidates with their numbers and short quotes from up to 5 entries they rest on, and returns `findings: [{ candidate, text }]`. Prompt in `prompts/weekly-review.v1.ts`.
2. **Numbers are checked:** every number in a finding's text must be one of its candidate's numbers. A finding that fails is dropped. If fewer than 3 survive, the candidates' own template sentences fill in ("Knee pain: 3 of 4 run days, 0 of 9 other days").
3. **Saved** like the brief: category `reflection`, `origin = 'system'`, `title = 'Weekly review'`, `logged_date` = the Sunday, `notes` = the findings as lines, `metrics = { kind: 'weekly_review', week: '<monday>' }`, ID `derivedId('weekly-review', <monday>)`, so two devices making it converge. One `llm_runs` row with `purpose = 'analysis'`.
4. **Thin weeks** save nothing; the card computes its totals live.

System rows are not entries: like the brief, the review is left out of Days' dots, Ask's counting tools and the extraction vocabulary.

## Who makes it, and when

Exactly as the [daily brief](daily-brief.md#when-and-where-it-is-made), in the same runner:

- **Due:** the week's Sunday after the brief time, or the previous week's when it was never made. Older weeks only by hand (**Make the review** on that Sunday's card).
- **This device** with its own analysis model, or **the hub** for a device in `hub` mode (`POST /v1/brief` gains `week: true`) and on its own after the grace period, like the brief.
- **Before making it** a device syncs and looks for the row, as for the brief.
- **Brief off** (`brief.enabled = false`) turns the review off too. No separate setting in this version.

## Privacy

The same line as the brief: private entries count only when the model runs on the machine that holds the data (an Ollama model on this device, or the hub's own for the hub's review). Otherwise they are left out of the days, the candidates and the quotes, before anything is counted. The live totals line on the device counts everything, as Days does. The cloud leak test (`packages/core/src/privacy/cloud-leak.test.ts`) gains the review.

## Errors

The existing LLM codes and help, as for the brief. A failed review shows on the card as *Couldn't put the patterns into words* with the help link and **Try again**; the totals still show.

## Data changes

None. The review is an `activities` row, `metrics.kind = 'weekly_review'` is already in the [registry](../architecture/data-model.md#metric-key-registry), and `week` joins it. The hub protocol's brief request gains an optional `week` flag.

## Done when

- A week with enough data gets one review on Sunday after the brief time, on the desktop, from the hub, and on the phone after its reminder; two devices end with one row.
- Every number in a saved finding is one the app computed (test with a model that makes numbers up).
- A thin week shows totals and the comparison with no AI call.
- A pattern that rests only on private entries never reaches a cloud model (leak test).
- The user guide has a Weekly review section on the Daily brief page.

## Not in this version

- Monthly reviews, or a page that lists every week.
- Choosing the day or the patterns by hand.
- Asking about a pattern in Ask ("why was I tired this week?").
