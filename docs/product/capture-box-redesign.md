# Capture box redesign (v0.4.0)

> **Status: planned 2026-11-10** ([roadmap Phase 8](../roadmap.md#phase-8--finding-and-using-data-v040)), from the user's findings. Covers the PC's capture box (the dock) only.

## Why

The capture box is the part of Avchetan used most, many times a day, and it should feel that way:

- It sometimes loses the keyboard: after the shortcut opens it, or after a click in the list, typing goes nowhere until Tab is pressed.
- Commands match only from the start of their name: `/ulk` finds nothing, and the list can't be moved through well.
- It looks plain: a flat panel rather than a floating search bar.

## Rules that don't change

- Capture never waits. Everything below is drawn from data already on the PC; nothing on the capture path calls the network.
- The text box always has the keyboard while the box is open, unless the user has moved into the list with the arrow keys.
- Esc never loses typed text: the draft is kept, as today.

## 1. The keyboard always works

- When the shortcut shows the box, the app focuses the webview from Rust and then the text box on the next frame, so the first key typed lands in it. Same after voice, after Ask finishes and after a command runs.
- Clicking a recent entry or a panel puts the keyboard back in the text box afterwards.
- **Keys:**

| Key | Does |
|---|---|
| ↓ (in an empty box, or with the list showing) | Moves into the list (commands, `/find` results, recent entries) |
| ↑ / ↓ | Moves through the list; ↑ from the first row returns to the box |
| Enter on a row | Runs the command, or opens that entry's day in the main window |
| Tab | Completes the highlighted command (`/unl` → `/unlock `) |
| Ctrl+Z with an empty box | Takes back the entry just saved (same as `/undo`); with text in the box it is normal text undo |
| Esc | One step back: leaves the list, then closes a panel, then hides the box |

## 2. Fuzzy commands

- What's typed after `/` matches the letters of a command **in order, anywhere in the name**, its learned aliases and its short description: `/ulk` → **unlock**, `/stg` → **settings**, `/dn` → **done**.
- Ranked: exact name, then start of the name, then start of a word, then letters in order (fewest gaps, earliest first).
- The best match is highlighted; Enter runs it, ↑/↓ choose another. When nothing matches, the existing *Not a command. Enter asks the AI to read it as one* stays.
- Lives in `packages/core/src/commands` (it replaces `suggestCommands`), so the phone can use it when it gets commands.

## 3. The new look

- **A floating search bar:** a large rounded panel with one big input line, a soft shadow and the Windows 11 backdrop (Mica, or Acrylic where Mica isn't available) through Tauri's `windowEffects`, so the desktop shows through blurred. Windows 10 gets a plain translucent panel.
- The list under the box grows only when there's something to show; with nothing to show the box is a single bar.
- Short, quiet animations (open, list grow, saved); none when Windows has animations turned off.
- Light and dark follow Windows.

## 4. Mode badge

A chip at the left of the box shows what Enter will do, changing as you type:

| Badge | When |
|---|---|
| ✎ Entry | Plain text |
| 🔒 Private | `!private` or a private tag in the text |
| ? Ask | Starts with `?` |
| / Command | Starts with `/` |
| 🔍 Find | Starts with `/find` |

## 5. Live hints while typing

Chips under the box show what the app will save, worked out on the PC with no AI:

- Tags typed (`#health/knee`), and when a tag is private.
- Day words read with the same rules the app uses to check deadlines (`dayWords` in `packages/core/src/extraction/date-check.ts`): *tomorrow → Wed, 11 Nov*.
- The window context that will be noted, with its **×**, as today.

They're hints: the AI still organizes the entry afterwards.

## 6. Save feedback

- After Enter: *Saved · Ctrl+Z to take back* for a few seconds, in place of a silent clear.
- The recent list shows each entry going from *Pending* to *Organized* as it happens.

## 7. Status line

The footer shows, from local data: tasks due today, entries waiting to be organized or sent, and a dot for the hub (synced / trying / not reached, with the time of the last sync on hover). Clicking an item opens the matching page.

## Find in the capture box

`/find words` shows the first 5 word matches from [plain search](finding-and-using-data.md#1-plain-search) in the list: ↑/↓ and Enter open that entry's day; Enter on the box itself opens the Search page with the words.

## Not in this version

- Changing the box's size or position from Settings.
- Search results while typing an ordinary entry: typing stays capture first.

## Done when

- On the desktop demo, the shortcut followed at once by typing never drops a key, 20 times in a row; every row and action is reachable without the mouse.
- `/ulk`, `/stg` and `/dn` pick the right commands (unit tests on the ranking).
- Windows 11 shows the blurred backdrop; Windows 10 a plain translucent panel.
- Badge, hints, saved message, status line and `/find` work on the demo and in the test build.
- [Capture on Windows](../user-guide/capture-on-windows.md) and [commands](../user-guide/commands.md) are updated.
