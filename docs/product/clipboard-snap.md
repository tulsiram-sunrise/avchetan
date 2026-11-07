# Clipboard snap

A second shortcut opens the capture box with the text on your clipboard attached: copy a stack trace, an address or a few lines of code, press **Ctrl+Shift+Alt+Space**, type `login fails on staging` and save. The entry keeps the copied text with it. It is the sixth and last item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence-) and replaces the clipboard line in [advancements §1](advancements.md#1-context-awareness-desktop-metadata-capture).

## Why

When something on the screen is worth logging, the useful part is often the exact text: the error message, the command, the link. Typing it again is slow, and pasting it into the box mixes it into what you wrote, so the AI reads the whole paste as your words.

## What it looks like

```
┌ Capture ───────────────────────────── Enter to save · Esc ┐
│ login fails on staging                                     │
│  ▣ Visual Studio Code · api.ts — my-project      ×         │
│  ⧉ Clipboard · TypeError: Cannot read properties o… ×      │
└────────────────────────────────────────────────────────────┘
```

- The normal shortcut works as before and never reads the clipboard. Only the clipboard shortcut does, and only at the moment you press it.
- A second line under the box shows the clipboard's first line, cut to fit. Clicking it shows the whole attached text (as it will be saved, at most 4 KB). **×** drops it from this entry only; the window line stays.
- Pressed while the box is already open, the clipboard shortcut attaches (or replaces) the clipboard text and keeps what you have typed. It never closes the box.
- When nothing is attached, the line says why for a few seconds instead: *Clipboard has no text* (an image or files), *Clipboard is empty*, or *Not attached: the clipboard came from an app that marks it private*. The box opens either way.
- On **Days** (both apps) an entry with clipboard text shows *with clipboard* next to *from …*. On the PC, *with clipboard* opens to the text in a fixed-width font, with **Copy**; on the phone the entry's page shows it, and a long-press copies it.

## What is recorded

| Field in `raw_logs.context` | Example | Notes |
|---|---|---|
| `clipboard` | `TypeError: Cannot read properties of undefined…` | Plain text only. Line endings made `\n`. At most 4 KB (UTF-8), cut at a character boundary |
| `clipboard_cut` | `true` | Present only when the text was longer than 4 KB |

- **Text only.** Images, files and other formats are never read or kept.
- **Read in Rust, cut in Rust:** at most 4 KB ever crosses into the webview, however large the clipboard is.
- **Private clipboard content is skipped.** Password managers mark what they copy so Windows keeps it out of clipboard history (the `ExcludeClipboardContentFromMonitorProcessing` format, or `CanIncludeInClipboardHistory` set to 0). When either is present, nothing is attached. This covers a password copied from a manager and then snapped over a browser.
- **Deny-list applies:** pressed over an app on the window context deny-list, nothing is attached, the same as the window line.
- **The pause does not:** **Pause window context for 1 hour** stops the window line only. The clipboard shortcut is something you press on purpose, so it still attaches.
- **Switching it off:** **Settings → Capture box → Clipboard snap → Attach the clipboard with a second shortcut** (default on). Off, the second shortcut is not registered at all.
- **Edit text** keeps the clipboard text, as it keeps the rest of the context.
- **Logs:** whether text was attached, its size in bytes and whether it was cut; never the text (non-negotiable rule 11).

## The shortcut

- **Default `Ctrl+Shift+Alt+Space`**, changeable under **Settings → Capture box → Clipboard snap**, the same way as the main shortcut: if another app holds it, Avchetan says so (`hotkey_unavailable`) and keeps the old one. It can't be the same as the main shortcut (`hotkey_invalid`).
- Saved in client setting `dock.snap_hotkey`.
- It also notes the window you were in, exactly as the main shortcut does (unless window context is off, paused or the app is denied).

## What the model sees

- The **first 1 KB** of the clipboard text goes into the extraction prompt as `clipboard`, marked as text the user copied for reference, not as their words or instructions. A new extraction prompt version says so; the eval runs before it ships.
- **`!private` entries:** the clipboard is not sent to any model, not even Ollama.
- With a cloud model the provider sees that 1 KB. [Privacy](../user-guide/privacy.md) says so, and the line in the box shows it is attached before you save.
- **Ask** and the **daily brief** don't receive clipboard text.

## How it's built

- **Rust** `clipboard.rs` `read_clipboard_text()`: `OpenClipboard` (a few short retries when another app holds it), check the two private formats, `GetClipboardData(CF_UNICODETEXT)`, convert and cut. Uses `windows-sys`, already a dependency; no new crate. Windows only; elsewhere it returns nothing.
- **Hotkey** `hotkey.rs`: a second shortcut on the same plugin; the handler tells the two apart. The snap handler reads the window context and then the clipboard, before the dock takes focus, and shows the dock (never hides it). `dock:shown` carries `{ context, clipboard }`, where `clipboard` is `{ text, cut }` or `{ none: 'empty' | 'not_text' | 'private' }`. New commands `snap_hotkey_status` / `snap_hotkey_set`.
- **Core** (pure, tested): `filterClipboard` (switch, deny-list), cutting and line endings checked again on the TS side, and `promptContext` adding the first 1 KB unless the entry is `!private`.
- **Desktop UI:** the clipboard line in the dock (`useDockStore.clipboard`), the Clipboard snap section in Settings → Capture box, *with clipboard* on Days and the text box on the entry page. **Phone:** *with clipboard* on Days and the text on the entry page, selectable (long-press to copy; no clipboard library added).

## Errors

- Shortcut taken or invalid: as for the main shortcut, with the same [troubleshooting](../user-guide/troubleshooting.md) sections.
- Clipboard held by another app for longer than the retries: the box opens with *Couldn't read the clipboard, try again*; the log records the error code only.

## Data changes

- `raw_logs.context` gains `clipboard` and `clipboard_cut` (JSON, no schema change; `clipboard` was already reserved).
- Client settings `clipboard.enabled` (true) and `dock.snap_hotkey` (`Ctrl+Shift+Alt+Space`).
- Extraction prompt version bump (clipboard as reference text).

## Done when

- Over a code editor with an error message copied, the clipboard shortcut opens the box with the window line and the clipboard line; the saved entry has `context.clipboard`, and the activity or task found reflects the copied text (for example the error's name in its title).
- The main shortcut never reads the clipboard (Rust test: its handler path doesn't call `read_clipboard_text`).
- A clipboard over 4 KB is cut at a character boundary with `clipboard_cut`; an image, an empty clipboard and a private-marked clipboard attach nothing and say why (Rust tests for cutting and the private formats; core tests for `filterClipboard` and `promptContext`, including `!private`).
- Over a denied app nothing is attached; while window context is paused the clipboard still is.
- **×** drops the clipboard only. Changing the shortcut works and refuses the main shortcut's keys.
- The [Windows guide](../user-guide/capture-on-windows.md) has *Attach the clipboard*, and [Privacy](../user-guide/privacy.md) lists clipboard text.

## Not in this version

- Images and files from the clipboard.
- Reading the clipboard on the phone (Android's share sheet to Avchetan is a separate idea).
- Browser page addresses (`url`).
