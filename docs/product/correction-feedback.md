# Correction feedback

When you fix something the model got wrong, the model sees that fix the next time a similar entry comes in. It is the second item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence) and replaces the outline in [advancements §7](advancements.md#7-new-correction-feedback-loop). There is no fine-tuning: the fixes become a few examples in the extraction prompt.

## Why

Small free models make the same mistakes again and again: the same kind of entry goes to the wrong category, gets a vague title, or turns a remark into a task. Today a fix stays on that one item, and the next similar entry needs the same fix.

## What counts as a correction

A correction is an **entry where you changed what the model made from it**:

| You did | It teaches |
|---|---|
| Changed an activity's title or category | "for this entry, the right activity is …" |
| Changed a task's title | "for this entry, the right task is …" |
| Deleted an activity or task the model made | "this is **not** an activity/task" (a negative example) |

- **Due dates never teach.** Changing one is usually moving the task to another day (the brief's **Move to tomorrow**, for one), not fixing what the model read, so examples show tasks without due dates. The edit still marks the task user-edited, so its entry is listed as an example, and **Organize again** keeps the new date. (Decided 2026-11-06 while trying the build.)
- Only items the model made (`origin = 'extraction'`) count. Your own items and system rows (the daily brief) never do.
- Deleting the **whole entry**, or editing its text (which replaces the entry), removes it as an example.
- The phone gets **activity editing** (title and category), so both apps can make the same corrections. Editing tags and metrics comes later.

## Where examples come from

Examples are built when an entry is extracted, from what is already synced ([ADR-0027](../decisions/0027-corrections-from-synced-edits.md)):

- **The entry's text and its items as they are now.** An edited item has `is_user_edited = true`. An item deleted by you also gets `is_user_edited = true` before `deleted_at`, so it can be told apart from items that re-extraction removed. As a bonus, re-extraction no longer brings back items you deleted.
- So a fix made on the phone teaches the desktop and the hub as well, with no new synced table.
- The client-local `extraction_corrections` table records each change field by field (`before`, `after`) in the same transaction as the edit. It is not used for the prompt. It is in the export and is the starting point for new [extraction fixtures](../conventions/testing.md), which are always rewritten as synthetic examples.

## How examples are chosen

In `@avchetan/core` (`extraction/corrections.ts`), on a `ClientStore`, so the apps and the server's device share it:

1. **Candidates:** live, processed entries with at least one corrected item, not forgotten, not the entry being extracted, from the 200 most recently corrected.
2. **Relevance:** words shared with the new entry (lowercased, 3 letters or more, common words left out), most recent correction first on a tie. No embeddings, so it works with Ollama alone.
3. **Up to 10 examples**, each cut to about 600 characters: the entry's text (to 280 characters), its capture date (so "tomorrow" in the example makes sense), then its activities (category slug, title, main metrics) and tasks (title only), then `not:` lines for deleted items.
4. **Prompt:** a new prompt version (`extraction.v2`) adds an "Examples from this user's corrections" section only when there are examples. Entries already organized are not extracted again.
5. **Too long for the model** (`llm_context_overflow`): the one retry leaves the examples out first, then tags and names as today.

## Privacy

Examples follow the same line as the vocabulary: an example from a `!private` entry goes only to a local model (`DataScope`). The hub's fallback extraction uses its own provider's scope in the same way.

## Your control

- **Where:** Settings → What Avchetan learned (desktop) and More → What Avchetan learned (phone), with the setting at the top and the list below. Guide: [Teach Avchetan with your fixes](../user-guide/corrections.md).
- **Setting:** "Learn from my corrections" (`extraction.learnFromCorrections`, a device setting, default on). Off means this device sends no examples. The hub follows `EXTRACTION_LEARN_FROM_CORRECTIONS` (default `true`).
- **What it learned:** a list of the examples (entry text and the corrected items, newest first, with a count), with **Forget** on each.
- **Phone tasks:** the entry screen shows its tasks as in Days, so they can be edited and deleted there too.
- **Forget** sets `raw_logs.example_forgotten_at` through the repository, so it syncs and every device and the hub stop using that entry. The entry and your fixes stay as they are.

## Data changes

- Synced `raw_logs` gets `example_forgotten_at` (UTC ISO, nullable), in both dialects with a migration each.
- `activities.deleteByUser` and `tasks.deleteByUser` in the repository: set `is_user_edited` on extracted rows, then soft-delete. Both apps call these for a delete you make; extraction and cascades keep using `softDelete`.
- `editByUser` and `deleteByUser` write `extraction_corrections` rows in the same transaction.
- Device setting `extraction.learnFromCorrections`; server env `EXTRACTION_LEARN_FROM_CORRECTIONS`.

## Done when

- An activity re-categorized on the phone makes the next similar entry on the desktop come out with that category in a mock-model test, and the example is in the prompt the desktop sends.
- A deleted item shows as a `not:` line, and re-extracting its entry does not bring it back (test).
- An example from a private entry never reaches a cloud model (fetch spy test, as for Ask).
- **Forget** on one device removes the example on the other after sync (two-store test).
- The prompt with 10 examples stays under the size the smallest preset's context can take (test on the rendered prompt).
- The [user guide](../user-guide/README.md) has a page on corrections: what counts, the setting, the list, privacy.

## Not in this version

- Editing tags and metrics (later; they would teach the same way).
- Choosing examples by embeddings.
- Turning corrections into fixtures automatically.
