# Pattern: Command registry

**Use when:** adding a capture-box `/command` ([command mode](../product/command-mode.md)), on the PC or the phone.

## Shape

- **The list** (`packages/core/src/commands/registry.ts`, `COMMANDS`): each command's `usage`, `help` and whether it takes text. The capture box's suggestions and the AI prompt that reads an unknown `/text` are built from it, so a new command needs no prompt edit.
- **Parsing** (`commands/parse.ts`): the `/` prefix, `//` escape, name or learned alias, the rest as text. Pure functions.
- **Shared handlers** (`commands/handlers.ts`, `planSharedCommand`): `done`, `find`, `brief`, `sync` and `undo` turn the text into a `CommandPlan` (a hint, a run, a choice between tasks, or an error). They take `SharedCommandDeps`: the device's write context, its words for messages, and callbacks for what only the app can do (make the brief, sync, open Days or Search, refresh after a write).
- **Per-app handlers**: `settings`, `lock` and `unlock` depend on the app's screens and its app lock, so each app plans them itself and hands the rest to `planSharedCommand` (PC: `apps/desktop/src/services/commands.ts`).
- **Reading with the AI** (`device/read-command.ts`): an unknown `/text` goes to the hub's model or the device's own, constrained to the registry's names, and is **always confirmed** before it runs.

## Rules

- Every write a command makes is one of the shared write actions (`packages/core/src/writes/actions.ts`, `runWrite`), so it goes through the repositories (outbox, LWW) exactly as the same edit made on a screen.
- A command that changes something pushes an undo onto the device's **undo list** (`commands/undo.ts`, `createUndoStack`): up to 20, newest first, kept while the app runs. An entry saved from the capture box joins it too (`rememberCapture`). Undoing is another shared write (reopen, soft delete), so it syncs like any edit.
- Commands, outcomes and counts may be logged; the typed text never (rule 11).
