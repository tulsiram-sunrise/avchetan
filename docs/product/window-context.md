# Window context

When you open the capture box on the PC, Avchetan notes which window you were in: the app and its title. Rules turn that into a project and tags, so `fixed the login bug` typed over VS Code on *my-project* lands in **Engineering** with `#my-project` without you typing either. It is the fifth item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence-) and replaces the outline in [advancements §1](advancements.md#1-context-awareness-desktop-metadata-capture) (clipboard snap is item 6).

## Why

Most entries written at the PC are about what is on the screen. The model can't see that, so it guesses the project from a few words, and you add the same tags by hand again and again.

## What it looks like

```
┌ Capture ───────────────────────────── Enter to save · Esc ┐
│ fixed the login bug                                        │
│  ▣ Visual Studio Code · api.ts — my-project      ×         │
│    rule: Engineering · #my-project                         │
└────────────────────────────────────────────────────────────┘
```

- Under the box, a line shows the app and its title, and the project and tags any rule adds. **×** drops the context from this entry only.
- Nothing shows when there is no context: the box was opened from the tray, the window was the desktop or Avchetan itself, the app is on the deny-list, context is paused, or it is turned off.
- On **Days** (both apps) an entry with context shows *from Visual Studio Code* under its text; the entry's page shows the full title. On the PC the entry's page also has **Make a rule from this**.

## What is recorded

Read by the Rust side when the hotkey fires, **before** the dock takes focus (Windows: the foreground window, its title and its program file):

| Field in `raw_logs.context` | Example | Notes |
|---|---|---|
| `app` | `Code.exe` | The program's file name. Rules match on it |
| `app_name` | `Visual Studio Code` | The program's own description, for display; the file name when it has none |
| `window_title` | `api.ts — my-project — Visual Studio Code` | At most 200 characters. Left out for browsers and when titles are off |
| `rule_matches` | `[{ rule_id, project_id, tag_paths }]` | What the rules gave at capture time (below) |

- **Default: on**, with a switch: **Settings → Capture box → Window context → Note the window I was in**.
- **Browsers record the app only.** For Chrome, Edge, Firefox, Brave, Opera, Vivaldi and Arc the title (the page you are on) is never kept, unless **Keep page titles in browsers** is turned on (default off).
- **Deny-list:** apps on it record nothing at all, not even their name. It starts with common password managers (1Password, Bitwarden, KeePass, KeePassXC, Dashlane, LastPass) and can be edited: remove any, add by file name or from **Recent apps** (the last 10 apps seen, kept only in memory).
- **Pause for 1 hour** from the tray: nothing is recorded until then. While paused the tray item reads *Window context paused until 14:30* with **Resume now**. The pause is kept across restarts (`context.paused_until`).
- **The model sees it.** Context goes into the extraction prompt as a hint, as it already does; with a cloud model that includes the title. [Privacy](../user-guide/privacy.md) says so. `!private` entries keep their context but, as always, only reach Ollama.
- **Logs:** whether context was recorded and how many rules matched, never the app or title (non-negotiable rule 11).

## Rules

A rule says: *in this app, with a title like this, the entry belongs to this project and gets these tags.*

| Field | Example | |
|---|---|---|
| App | `Code.exe` | File name, `*` wildcards allowed, case doesn't matter |
| Title contains | `my-project` | Optional. Plain text, or a pattern (regex) when **Pattern** is ticked. A pattern can name a part `(?<project>…)` |
| Project | Engineering | Optional, from your projects |
| Tags | `my-project`, or `{project}` | Optional. `{project}` is the part the pattern named, made a tag (`My Project` → `my-project`) |

- **Stored** in the existing columns: `app_pattern`, `title_pattern` (plain text, or a pattern written between slashes, `/…/`, when **Pattern** is ticked), `project_id`, `tag_paths`, `enabled`.
- **Matching happens at capture**, on the PC, from the synced `context_rules` table, and the result is written into the entry's `rule_matches`. The entry doesn't change when a rule changes later.
- **What a match does:** its tags count as if you had typed them as `#tags`; its project is set on every activity and task found in the entry, whatever the model says. When several rules match, all their tags apply and the first rule with a project (oldest first) sets it. This happens in extraction wherever it runs (PC, phone or hub), so it needs no change to delegate mode.
- **What the model sees:** the app name and the title only (`app`, `window_title`), never the rule matches.
- **Edit text** keeps the entry's context and its rule tags.
- **Where:** **Settings → Capture box → Window context → Rules** lists them with on/off, edit and delete. **Make a rule from this** on an entry fills in its app and title. The form shows whether the rule matches that entry's context as you type.
- Rules are synced, so a second PC uses them too. The phone doesn't capture context and doesn't show rules.

## How it's built

- **Rust** `src/context.rs` (`previous_window_context`): `GetForegroundWindow`, `GetWindowTextW`, the process file via `QueryFullProcessImageNameW`, its description from the file's version info. Called by the hotkey handler before the dock is shown; the result goes to the webview with `dock:shown`. It skips Avchetan's own windows, the desktop and the taskbar. Uses `windows-sys` (MIT or Apache-2.0, already in the dependency tree), Windows only; other systems return no context. It also keeps the last 10 apps in memory for **Recent apps** (`context_recent_apps`). A program without a readable description (Store apps such as Notepad) shows its file name without `.exe`.
- **Core** `context/` (pure, tested): `filterContext` (switch, pause, deny-list, browsers, title length), `matchRules` (glob, contains or regex, `{project}` tags), and applying `rule_matches` in extraction post-processing.
- **DB:** a `contextRules` repository (create, update, soft delete, list enabled oldest first) through the usual sync-aware writes. The table already exists in both dialects; no migration.
- **Desktop UI:** the context line in the dock, the Window context section in Settings, the line on Days and **Make a rule from this**. **Phone:** the *from …* line on Days and the entry page.
- **Tray:** **Pause window context for 1 hour** / **Resume now**, from client-local setting `context.paused_until`.

## Errors

None shown to you. If Windows refuses to tell which window was in front (for example an app running as administrator), the entry simply has no context; the log says so with no details.

## Data changes

- `raw_logs.context` gains `app_name` (JSON, no schema change).
- Repository for the existing `context_rules` table.
- Client settings `context.enabled` (true), `context.browser_titles` (false), `context.deny_list` (the password managers), `context.paused_until` (empty string when not paused).

## Done when

- Over a code editor, the dock shows the app and title; the saved entry has them in `context`, and a rule for that app and title gives the entry's activities its project and the entry its tags, also when the hub does the extraction (test with two stores).
- Over a browser, only the browser's name is kept; with **Keep page titles in browsers** on, the title too.
- Over an app on the deny-list, and while paused, nothing is kept. Pause ends by itself after an hour and survives a restart.
- **×** in the dock drops the context from that entry.
- `matchRules` and `filterContext` have unit tests (wildcards, case, regex with `{project}`, a broken regex is reported in the form and never throws at capture); the Rust side has tests that an unknown window gives no context, that a program's description is read, and that recent apps keep the last 10 without repeats.
- The [Windows guide](../user-guide/capture-on-windows.md) has *Window context and rules*, and [Privacy](../user-guide/privacy.md) lists window titles.

## Not in this version

- Browser page addresses (`url`); clipboard snap (item 6).
- Suggesting rules from your history.
- Context on the phone.
