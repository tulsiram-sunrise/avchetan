# Command mode

Type `/` in the desktop capture box to act instead of log: finish a task, make the daily brief, sync. It is the third item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence-) and replaces the outline in [advancements §3](advancements.md#3-unified-command-dock-capture--ask--act) for this version.

## Why

The capture box is always one shortcut away, but doing anything other than logging means opening the main window and finding the thing. A few common actions belong in the box itself, next to `?` for questions.

## What it looks like

```
┌ Command ────────────────────── Enter to run · Esc to close ┐
│ /done foam                                                 │
│  ✓ Done: Foam roll the calves                    Enter     │
│    also: Buy foam mat                            ↓         │
└────────────────────────────────────────────────────────────┘
        ↓ after Enter
  Done: Foam roll the calves                         [Undo]
```

- Typing `/` switches the label from **Capture** to **Command** and shows the commands with one line of help each. The list narrows as you type, and Enter on a partly typed name completes it (`/br` → `/brief `).
- The line under the box always says what Enter will do. Nothing changes until Enter.
- An entry that should start with `/` is written with `//`; the first `/` is dropped and it is saved as usual.
- Desktop only in this version. The phone keeps its buttons.

## Commands

| Command | Does | Confirm? | Undo |
|---|---|---|---|
| `/done <words>` | Marks the open task that best matches the words as done | Only when two tasks match about equally: pick one with ↑↓ | Reopens it |
| `/brief` | Makes today's [daily brief](daily-brief.md) now (or asks the hub, as **Make the brief now** does) and opens Days on today | No | None (delete the brief in Days) |
| `/sync` | Syncs now and says the result | No | Nothing to undo |
| `/undo` | Undoes the newest of: the last entry saved from the capture box (a soft delete, with what the AI made from it) or the last command that changed something, from this session. The line says what it will undo: *Undo: delete “Bought milk…”*, *Undo: reopen “Call the plumber”* (added 2026-11-08) | Enter on that line | — |
| `/settings <tab>` | Opens the main window on Settings, or on a tab: its id (`ai`, `capture`, `voice`, `brief`, `privacy`, `hub`, `data`, `general`), the start of a word in its name, or `lock`, `sync`, `shortcut`, `commands`, `models` (added 2026-11-08) | No | Nothing to undo |
| `/lock` | Locks Avchetan at once ([app lock](app-lock.md)); with the lock off, says how to turn it on (added 2026-11-08) | No | Nothing to undo |
| `/unlock` | Unlocks with Windows Hello; says so when it's already unlocked or the lock is off (added 2026-11-08) | No | Nothing to undo |

- **Matching for `/done`:** open tasks scored by shared words with the text (lowercased, common words left out), then how recently they were due. No match: "No open task matches 'foam'", nothing changes.
- **Undo:** after a command that changed something, **Undo** shows for 10 seconds; `/undo` works any time until the capture box is restarted, for commands and for entries saved from the capture box (up to 20, newest first). Undo goes through the same repository writes, so it syncs like any edit.
- **Confirm before several changes:** a command that would change more than one row first shows the list and waits for Enter (none of the v1 commands does this yet; the registry supports it for later ones such as `/move overdue`).

- **While the app is locked** ([app lock](app-lock.md)): `/lock`, `/unlock`, `/settings` and the list of commands while a name is typed work as usual, since they show nothing written before. Every other command, `/undo` included, shows *Unlock to ask or run commands*; Enter brings up Windows Hello and then runs it.

## When the text isn't a command

`/finish the plumber thing` is not a known command. Enter then asks the AI to read it as one of the commands:

```
│ /finish the plumber thing                                  │
│  AI reads this as:  /done plumber  →  Call the plumber     │
│  Enter to run, Esc to cancel                               │
```

- **Always confirmed:** an AI reading runs only after a second Enter.
- **What the AI sees:** the text after `/` and the list of commands with their help. Never your tasks or entries: finding the task stays on the PC.
- **Which model:** with `analysis.mode = hub`, the hub's answers model through `POST /v1/command` ([server](../architecture/server.md)), which receives only the typed words and earlier confirmed readings; a hub without it gives `hub_outdated`. Otherwise this PC's answers model, else its organizing model ([AI models](../user-guide/ai-models.md)). With neither, offline, or with the hub out of reach, the box says so and shows the list of commands instead, with a help link.
- **One small structured call** (`generateStructured`, schema `{ command, args } | { none: reason }`, prompt `prompts/command.v1.ts`), so small models manage it. A reading of "none" says "Couldn't read this as a command" with the list.

### Learning from confirmations

When you confirm an AI reading, Avchetan learns from it, so the next time needs no AI:

1. **First words become aliases.** `/finish the plumber thing` read as `/done plumber`: `finish` now means `done`. The next `/finish …` runs as `/done …` straight away, and the hint says "finish = done (learned)". An alias is learned only when its word isn't a command already.
2. **Readings become examples.** The last 20 confirmed readings go into the command prompt as examples, so phrasings that aren't a single word get better too.
3. **Settings → Capture box → Commands** lists the learned aliases and examples, each with **Forget**, and has a switch "Learn from commands I confirm" (default on).

Learning is per PC, kept in client-local settings (`commands.aliases`, `commands.examples`, `commands.learn`): command mode is desktop-only, and these phrases are not log content to sync.

## How it's built

- **Registry in `@avchetan/core`** (`commands/registry.ts`): each command's `name`, `help`, Zod `args` schema, `changes` (whether it writes) and `requiresConfirm(preview)`. The AI prompt is built from it, so a new command needs no prompt edit.
- **Handlers in the desktop app** (`services/commands.ts`): they run in the dock (it already serves all writes, ADR-0019), go through the repositories, and return a preview, the result text and an undo function.
- **Parsing** (`commands/parse.ts` in core): `/` prefix, `//` escape, name or learned alias, the rest as arguments. Pure functions with tests.
- **Logging:** command names, outcomes and counts only, never the text (non-negotiable rule 11).

## Errors

Model failures use the existing LLM codes and [error help](../user-guide/troubleshooting.md). New: `command_unknown` ("Couldn't read this as a command") and `command_no_match` ("No open task matches …"), each with a troubleshooting section.

## Data changes

None on synced tables. Client settings `commands.learn`, `commands.aliases` (word → command), `commands.examples` (text → command and args, newest 20).

## Done when

- `/done <words>` completes the right task, and **Undo** reopens it on this PC and, after sync, on the phone (test with two stores).
- `/brief` makes today's brief, or asks the hub; `/sync` syncs and says so.
- `/finish …` is read by the AI and runs only after confirmation; after that, `/finish …` runs without a model call (test with the mock model counting calls).
- The AI request contains no task titles or entry text (fetch spy test).
- `//note` saves an entry "/note".
- The [user guide](../user-guide/README.md) has a Commands page; Settings → Capture box → Commands lists and forgets what was learned.

## Not in this version

- The phone.
- `/move`, `/clear-completed` and other bulk commands (the registry's confirm step is ready for them).
- "Create task?" chips in Ask answers.
