# People and promises

See the people in your log, and what you and they promised. A **People** page lists everyone your entries name. Each person's page shows when you last saw them, what you owe them, what they owe you, and every entry that mentions them. Ask can answer *"What do I owe Rahul?"*, *"When did I last see Aman?"* and *"Who did I talk to about the migration?"*. This is item 2 of [Phase 7](../roadmap.md#phase-7--advancements-b-voice-graph-patterns-privacy), and it replaces the outline in [advancements §5](advancements.md#5-knowledge-graph-of-people--commitments).

## Why

Extraction has stored people, places and organizations since Phase 3 (`entities`, `entity_mentions`), but nothing shows them. The most useful part is promises: a task that is done for someone is easy to forget, because the log mentions the person once and never again. Promises in the other direction are easier still to forget (*"Aman will send the photos by Friday"*).

## Decisions (2026-11-08)

| Question | Decision |
|---|---|
| What counts as a promise | **Any task done for or given to a named person** (*"Send Rahul the schema"*, *"Call mom back"*), not only "promised" wording. A wrong one is unmarked with one tap. |
| Direction | **Both.** *You owe* (role `owed_to`) and *They owe you* (role `owed_by`, shown as *Waiting on*). |
| Where | A **People** page in the PC's main window, after Tasks. On the phone, **More → People**; the bottom tabs stay as they are. |
| Duplicates | **Rename and merge by hand.** The app suggests likely duplicates but never merges by itself. |
| Which entities | The page lists **people**. Places, organizations and the rest stay stored and reachable through Ask, but get no page in this version. |

## What it looks like

### People page

```
┌ People ───────────────────────────────────────────────┐
│ Search people…                                        │
│                                                       │
│ Rahul        You owe 2 · last seen Tue                │
│ Aman         Waiting on 1 (overdue) · last seen 3 Nov │
│ Priya        last seen 28 Oct                         │
│ ⓘ Same person? Rahul / Rahul Sharma   [Merge] [No]    │
└───────────────────────────────────────────────────────┘
```

- Sorted by open promises first (overdue on top), then by when you last saw them.
- **Last seen** is the latest day with an entry that mentions them as `with` (you were together or talked). Mentions as `about` don't count as seeing them.
- **Same person?** A suggestion shows when one name is the start of another (`rahul` / `rahul sharma`), or when two names differ by one letter (`priya` / `pria`). **No** hides that pair for good on this device.

### A person's page

```
┌ Rahul ─────────────────────────────── [Rename] [Merge into…] ┐
│ Last seen Tue 4 Nov · 9 entries                              │
│                                                              │
│ You owe                                                      │
│  ☐ Send the schema design          due Wed     [Not a promise]│
│  ☐ Return the charger                                        │
│ Waiting on Rahul                                             │
│  ☐ Get the invoice from Rahul      due Fri 31 Oct (overdue)  │
│                                                              │
│ Entries                                                      │
│  Tue 4 Nov  Lunch with Rahul at Cafe Lotus…                  │
│  …                                                           │
└──────────────────────────────────────────────────────────────┘
```

- **You owe** and **Waiting on** are open tasks. Ticking one marks the task done, as on the Tasks page. A done promise moves to a collapsed *Done* list.
- **Not a promise** removes the promise link and keeps the task. The task becomes *edited by you*, so a later re-run of extraction doesn't put the link back.
- On a task anywhere (Tasks page, Days, an entry), **Promise to…** or **Waiting on…** adds a link by hand: pick a person or type a new name.
- **Entries:** the entries that mention the person, newest first, with the same lock and private marks as on Days.
- **Rename** changes how the name is shown. The old name is kept as an alias, so new entries that use it still land here.
- **Merge into…** picks another person. Everything moves to that person, and both names become aliases. It asks first, because it can't be undone in this version.

### Tasks page and the daily brief

- **Waiting on** tasks are not your work, so the Tasks page shows them in their own collapsed group, *Waiting on others*, after your open tasks. Days shows them with *Waiting on Aman*.
- The daily brief's rolled-over list leaves out *Waiting on* tasks. A *Waiting on* task that becomes overdue shows once on that day as *Aman was to send: the photos (due Fri)*, with **Remind me tomorrow** (moves the due date by a day).

### Ask

Two new tools, which follow the same rules as the others (refs to cite, private scope):

- **`query_entities`** `{ name?, kind?, topic? }`: matches names and aliases. For each match it returns the kind, the last-seen day, the entry count, and up to 10 recent entry refs. `topic` finds the entries that contain the word (the same search as `search_entries`) and returns the people they mention: *"Who did I talk to about the migration?"*.
- **`query_commitments`** `{ person?, direction: 'i_owe' | 'owed_to_me' | 'both', status: 'open' | 'done' | 'overdue' }`: promises with their title, due date, person and task ref.

*"What do I owe Rahul?"* must answer from `query_commitments`. That is the roadmap's *done when*, and it gets a fixture in the Ask eval.

### Finding promises in old entries

Entries saved before this version have people, but few promise links. On the People page, **Look for promises in older entries** (shown once while there are some) re-runs extraction on entries that have a task and name a person, oldest first, in the background, with a count. Tasks you edited are left alone, as always. It uses the AI you set up, so a cloud model's free-tier limits apply. Private entries wait for a local AI, as they do now.

## How it's built

### Extraction (`packages/core`)

- **Prompt `extraction.v4`:**
  - Roles. `owed_to`: the task is done for or given to that person (*send, give, return, pay, call back, reply to*). `owed_by`: the person said they would do something for the user.
  - A task the user is waiting on is written from the user's side, starting with a verb (*"Get the photos from Aman"*), with its due date and an `owed_by` mention.
  - New fixtures: promise wording in English, Hindi and Hinglish; a task naming someone who is not owed anything (*"Meet Rahul at 5"* is `with`, not `owed_to`); a waiting-on item with a date; a reported promise that isn't the user's (*"Aman promised Priya…"* makes no task).
  - Eval on Gemini, Groq and Ollama `granite4.2:8b` before switching, and note the results in [open-questions R20](../open-questions.md). v3 stays until v4 is at least as accurate on the old fixtures.
- **Entity resolution** (`entitiesRepo.ensure`): look up a live entity of that kind whose `normalized_name`, or one of whose normalized aliases, matches. Only when there is none, create one with the derived ID, as now. This is what makes rename and merge stick when an old name is used again.

### Data (`packages/db`)

- **No schema change.** Renaming, merging and promise links use the existing columns: `name`, `normalized_name`, `aliases`, `deleted_at`, and `entity_mentions.role`.
- **Rename:** set `name` and `normalized_name`, and add the old name to `aliases`. The ID stays.
- **Merge B into A,** in one transaction:
  1. Add B's name and aliases to A's aliases.
  2. For each live mention of B, upsert the same mention for A (its derived ID uses A's ID) and soft-delete B's mention.
  3. Soft-delete B.
- **Not a promise / Promise to…:** the mention is soft-deleted or added through `entitiesRepo`, and the task gets `is_user_edited = true`, which already makes extraction leave a task's mentions alone.
- **Queries** (`queries.ts`): `listPeople` (with open promise counts and last seen), `personDetail`, `promises({ entityId?, direction, status })`, and `duplicateSuggestions`. All filter `deleted_at IS NULL`, and they use `DataScope` so that Ask with a cloud model never sees private entries or the people only they name (`sharedEntityIds`).
- The pairs dismissed with **No** are a client-local setting (`people.dismissedPairs`), not synced.

### Apps

- **Desktop:** `main-window/people-page.tsx` and `person-page.tsx`, sidebar item **People** after Tasks. Tasks page group *Waiting on others*. The task menu gains **Promise to…** / **Waiting on…**.
- **Phone:** `app/people/index.tsx` and `app/people/[id].tsx`, opened from More → People. The same task menu actions.
- **Daily brief:** waiting-on tasks leave bullet 3, and the overdue one-liner is built by the app, not the model.

### Privacy

- A person named only in private entries still shows on the device's own People page. Ask with a cloud model, and the cloud extraction prompt's list of known names, never sees them (this already holds for the prompt's names).
- The existing fetch-spy leak test ([private entries](private-entries.md)) gains both new Ask tools: a person named only in a private entry and a private promise must never reach a cloud call.
- **Logs:** counts and IDs only, never names (rule 11).

## Errors

None new. A merge or rename failure is a local database error and uses the existing `db_query_failed` help ("Couldn’t save this change").

## Done when

- *"What do I owe Rahul?"* in Ask answers from `query_commitments` with the right tasks (fixture and a hand test).
- A new entry *"Promised Rahul the schema design by Wednesday"* shows under Rahul → *You owe* with Wednesday's date, on both apps after sync.
- *"Aman will send the photos by Friday"* shows under Aman → *Waiting on*, not in your open tasks, and is left out of the brief's rolled-over list.
- Rename and merge survive re-extracting an entry that uses the old name.
- The leak test covers both new tools.
- The user guide has a People page.
