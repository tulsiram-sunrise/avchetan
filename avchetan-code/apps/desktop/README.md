# @avchetan/desktop

The Windows app: a Tauri v2 shell (`src-tauri/`, thin Rust) around a React webview with two windows, the **dock** (quick capture) and the **main** window. Architecture: [docs/architecture/desktop.md](../../../docs/architecture/desktop.md).

## Requirements

- Node ≥ 24 and pnpm (see the repository README).
- Rust stable (`winget install Rustlang.Rustup`).
- Visual Studio Build Tools with the C++ workload:
  `winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
- WebView2 (preinstalled on Windows 11).

## Commands (run in `avchetan-code/apps/desktop`)

| Command | What it does |
|---|---|
| `pnpm dev` | Start Vite and the app with hot reload (`tauri dev`) |
| `pnpm build` | Build the Windows installer (NSIS) into `src-tauri/target/release/bundle/` |
| `pnpm vite:build` | Build only the web assets (no Rust needed) |
| `pnpm test` / `pnpm typecheck` | Vitest / TypeScript (no Rust needed) |
| `cargo fmt --check` / `cargo clippy -- -D warnings` | Rust format and lint (run in `src-tauri/`) |

The dev database lives in `%APPDATA%\app.avchetan\avchetan.db`. Delete it to start fresh.

To drive the webviews from a script (smoke tests), start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`. The pages then show up at `http://127.0.0.1:9222/json` for any DevTools-protocol client.

## Layout

```
src/
  bootstrap.tsx      shared startup for both windows (services, query client, error screen)
  app-services.ts    composition root: native database → client store → services
  platform/          adapters (Platform type)
  native/            typed, Zod-validated wrappers around Rust commands and events
  services/          capture, draft, hotkey and autostart logic (unit-tested)
  queries/           TanStack Query hooks
  stores/            Zustand UI state
  dock/  main-window/  the two windows
src-tauri/src/
  lib.rs  windows.rs  hotkey.rs  tray.rs  error.rs  commands/{db,secrets}.rs
```

## Manual smoke checklist (Phase 2, Windows 11)

Run with `pnpm dev`, then with an installed `pnpm build`. Tick every line before closing Phase 2. Results from the 2026-10-29 run on Windows 11 (1440×900, scripted keys plus the DevTools protocol) are in *italics*; the tray, restart and sign-out lines were checked by hand on 2026-10-30.

- [x] First launch: no window appears. The dock is hidden at start. *Dock hidden at start; tray icon not checked by script.*
- [x] `Ctrl+Shift+Space` shows the dock in < 100 ms, on the monitor with the mouse pointer, with the text box focused. *9–30 ms over 5 runs; position (460, 167) = centered, upper third; focus in the text box.*
- [x] Pressing the shortcut again hides the dock. So do `Esc` and clicking another window (blur).
- [x] Type a half sentence, hide the dock, show it again: the text is still there.
- [x] Type a half sentence and quit from the tray. Start the app again: the text is still there. *Checked by hand.*
- [x] Enter saves. The entry appears at the top of the recent list with a *Pending* badge, and the box empties.
- [x] `Shift+Enter` adds a new line instead of saving, and *Settings → Saving an entry* swaps the two keys. *Default and swapped modes checked; a change in Settings reaches the open dock at once.*
- [x] `#Health/Knee` in an entry creates the tag `health/knee`, and `!private` saves as private. *Covered by tests on the real capture path.*
- [x] Dev console shows `capture committed` with `p95Ms` < 10 after 20 or more captures. *Plain entries: p95 7.2 ms (median 6.0). Entries with a `#tag`: p95 ≈ 11 ms (median 7.7), accepted as an exception for now (roadmap, Later).*
- [x] Tray: left-click toggles the dock. The menu has *Open Avchetan*, *Preferences*, *Pending: N* (updates after each capture) and *Quit*. *Checked by hand.*
- [x] *Open Avchetan* shows the timeline grouped by day, including entries just captured from the dock (it refreshes without a restart).
- [x] Closing the main window hides it. Reopening it is instant.
- [x] *Preferences* opens Settings. Changing the shortcut to `Ctrl+Alt+Space` works right away. *Works at once and the old shortcut is released; persistence across a restart is covered by tests.*
- [x] An invalid shortcut is rejected and the old one keeps working. *Help link not clicked (it would open a browser).*
- [x] Start with Windows is on after first launch. Sign out and back in: the app is running (tray icon present). *Checked by hand.*
- [x] Launching the app a second time shows the dock of the running instance and doesn't start another.
- [x] Timers keep firing while the dock is hidden. *7 ticks over 3.5 min, all within ±11 ms; WebView2 doesn't even report the hidden window as hidden, so no throttling and no Rust heartbeat needed.*
- [x] Offline (emulated): the footer says *Offline* and capture still works.
