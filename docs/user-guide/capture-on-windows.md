# Capture on Windows

> Draft — describes planned behavior.

**Goal:** write something down in two seconds, from any app.
**You need:** Avchetan running (its icon is in the system tray, near the clock).

## Write an entry

1. Press **Ctrl+Shift+Space**, from any app. A small box opens in the middle of your screen.
2. Type what happened or what you need to do, for example `Walked 30 minutes, remind me to buy milk tomorrow`.
3. Press **Enter** to save it. The box empties, and the entry appears underneath with a *Pending* badge.
4. Press **Esc** (or click anywhere else) to close the box.

Need more than one line? Press **Shift+Enter** to start a new line.

Half-written text is kept, even if you close the box or restart your PC.

## Add tags and keep entries private

- Type `#` before a word to tag the entry: `#health`, or `#health/knee` for a tag inside another tag.
- Type `!private` anywhere in the entry to keep it on your own devices. Private entries are never sent to an online AI service.

## Change the keys

Open Avchetan (tray icon → **Open Avchetan**) → **Settings**.

- **Shortcut:** type a new one, for example `Ctrl+Alt+Space`, and click **Save**. If another app already uses it, Avchetan says so and keeps the old one.
- **Saving an entry:** choose whether **Enter** saves and **Shift+Enter** starts a new line (the default), or the other way round. Swap them if you often write entries longer than one line.
- **Start with Windows:** leave this on so the shortcut works right after you sign in.

## Check it worked

Press your shortcut, type `Test entry #test` and press your save key. The entry appears at the top of the list, and *Open Avchetan* shows it in the timeline.

## Common problems

- **Nothing happens when I press the shortcut.** Another app may use it. The box shows a warning the next time you open it from the tray. See [hotkey_unavailable](troubleshooting.md#hotkey_unavailable).
- **"Couldn't save this entry."** See [db_query_failed](troubleshooting.md#db_query_failed).
