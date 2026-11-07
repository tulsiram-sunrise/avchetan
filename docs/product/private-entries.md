# Private entries

An entry with `!private`, or with a tag you marked private, is read only by an AI on your own hardware (Ollama, on your PC or your Home Hub). Cloud AI never sees it: not to organize it, not to answer a question, not for a daily brief. Without a local AI it waits, says why, and is organized as soon as one is available. It is the first item of [Phase 7](../roadmap.md#phase-7--advancements-b-voice-graph-patterns-privacy) and replaces the outline in [advancements §6](advancements.md#6-new-privacy-local-routing).

## Why

Much of this already works: `!private` sets `raw_logs.privacy = 'local_only'`, and extraction, Ask, the daily brief, the vocabulary sent to a cloud model, the hub's embeddings and the hub's fallback all leave such entries to local models. What's missing is what makes it usable every day:

- You have to remember `!private` every time, even for topics that are always private (health, money).
- Without a local AI a private entry is quietly marked *Skipped*, with no hint why and no way back except **Organize again**.
- Nothing shows which entries are private, and an entry can't be made private, or normal again, after it is saved.
- No single test proves a private entry never reaches a cloud provider.

## What it looks like

```
Days
  09:12  🔒 knee hurt on the stairs again #health/knee
         Private: waits for a local AI   How to set one up
  09:40  ran 5k in 28 min
         Workout · Morning run
```

- **Lock** before a private entry's text on **Days**, on both apps.
- **Waiting without a local AI:** the entry stays *Pending* with *Private: waits for a local AI* and a link to [AI models](../user-guide/ai-models.md). It is organized once Ollama is set up on this device, or the Home Hub (with its own Ollama) picks it up. You can still add tags by hand meanwhile.
- **Make private / Make normal** in the entry's **Options** (PC) and on the entry's page (phone).
  - *Make private:* from then on no cloud AI reads it. Anything a cloud AI already made from it stays; the confirmation says so.
  - *Make normal:* the next organizing may use a cloud AI. A private entry still waiting is then organized by your usual model.

## Private tags

**Settings → AI → Private tags** (PC) and **More → Settings → Private tags** (phone): a list of tags that make an entry private.

- **Add** by typing a tag (`health`) or choosing from your tags; **Remove** with ×. Empty by default.
- **A tag covers everything under it:** `health` also matches `#health/knee`.
- **Which tags count:** the tags you type (`#health/knee`) and tags a [window context rule](window-context.md#rules) adds. Not tags the AI suggests: those arrive after the AI has read the entry.
- **When:** at capture, on the device, in the same local transaction (rule 1: no network). **Edit text** checks again, so adding `#health` later makes the entry private; removing it leaves the entry as it is (use **Make normal**).
- **Synced:** marking a tag private on the phone applies on the PC too.
- Renaming or merging a tag keeps the mark (a merge into an unmarked tag marks the target: private wins).

## What a local AI is

A model whose provider runs on your own hardware: Ollama, directly or through the Home Hub. The existing `local` flag on each provider adapter decides; nothing new. OpenAI-compatible servers count as cloud even at a local address, as now.

## How it's built

- **DB:** `tags.makes_private` (boolean, default false) in both dialects with a migration each; the tags repository gets `setMakesPrivate` and keeps the mark through rename and merge. `rawLogs.capture` and `rawLogs.replace` set `privacy = 'local_only'` when `!private` is present or any explicit or rule tag is at or under a private tag. A new `rawLogs.setPrivacy` (sync-aware, bumps `updated_at`).
- **Core:** the pending processor no longer turns a private entry into *Skipped* when no allowed model is local: it leaves it `pending_llm` and its query skips such entries, so the loop doesn't spin on them. `isWaitingForLocalAi(rawLog, models)` for the badge. Making an entry normal wakes the processor.
- **Hub:** unchanged: its fallback already takes private entries only when its own models are local.
- **Old entries** marked *Skipped* only because they were private keep that status; **Organize again** on them now waits for a local AI instead of skipping again.
- **The leak test:** one test with a fetch spy runs extraction, Ask, the daily brief and hub embeddings with a cloud model over a store holding a private entry, and fails if any request body contains its text, its tags or its names. The [Phase 7](../roadmap.md#phase-7--advancements-b-voice-graph-patterns-privacy) "Done when" names this test.
- **Logs:** counts of private entries waiting, never their text (rule 11).

## Errors

None new. *Private: waits for a local AI* is a state, not an error; its link goes to [AI models](../user-guide/ai-models.md).

## Data changes

- `tags.makes_private` boolean, default false (both dialects, migrations, schema parity test).
- No change to `raw_logs` (`privacy` exists).

## Done when

- `#health/knee` typed with `health` marked private gives a private entry on both apps; with a cloud model only it stays *Pending* with the badge, and is organized once Ollama is set up.
- **Make private / Make normal** change the entry on both apps and sync; making a waiting entry normal gets it organized.
- The fetch-spy test passes for extraction, Ask, the daily brief and hub embeddings.
- The lock shows on Days on both apps; the private tag list syncs.
- [Capture on Windows](../user-guide/capture-on-windows.md), [Capture on Android](../user-guide/capture-on-android.md), [AI models](../user-guide/ai-models.md) and [Privacy](../user-guide/privacy.md) describe private tags and waiting.

## Not in this version

- Keeping private entries off the hub or server (*don't sync private*): your hub or server is your own; noted in [open questions](../open-questions.md).
- Window context rules that make an entry private on their own (they can add a private tag).
- Encrypting private entries on disk (SQLCipher is under [Later](../roadmap.md#later--unscheduled)).
