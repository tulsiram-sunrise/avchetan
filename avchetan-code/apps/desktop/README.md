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

Run with `pnpm dev`, then with an installed `pnpm build`. Tick every line before closing Phase 2.

- [ ] First launch: no window appears and the tray icon is visible. The dock is hidden at start.
- [ ] `Ctrl+Shift+Space` shows the dock in < 100 ms, on the monitor with the mouse pointer, with the text box focused.
- [ ] Pressing the shortcut again hides the dock. So do `Esc` and clicking another window (blur).
- [ ] Type a half sentence, hide the dock, show it again: the text is still there.
- [ ] Type a half sentence and quit from the tray. Start the app again: the text is still there.
- [ ] Enter saves. The entry appears at the top of the recent list with a *Pending* badge, and the box empties.
- [ ] `Shift+Enter` adds a new line instead of saving.
- [ ] `#Health/Knee` in an entry creates the tag `health/knee`, and `!private` saves as private (check with a DB viewer).
- [ ] Dev console shows `capture committed` with `p95Ms` < 10 after 20 or more captures.
- [ ] Tray: left-click toggles the dock. The menu has *Open Avchetan*, *Preferences*, *Pending: N* (updates after each capture) and *Quit*.
- [ ] *Open Avchetan* shows the timeline grouped by day, including entries just captured from the dock (it refreshes without a restart).
- [ ] Closing the main window hides it. Reopening it is instant.
- [ ] *Preferences* opens Settings. Changing the shortcut to `Ctrl+Alt+Space` works right away and survives a restart.
- [ ] Setting a shortcut another app owns shows the error with a working *Help* link (opens in the browser), and the old shortcut keeps working.
- [ ] Start with Windows is on after first launch. Sign out and back in: the app is running (tray icon present).
- [ ] Launching the app a second time shows the dock of the running instance and doesn't start another.
- [ ] Timers keep firing while the dock is hidden: leave it hidden for 10 minutes and check the `timer-probe` `tick` lines in the dev console (every 30 s). `lateMs` should stay under about 1000 with `hidden: true`. If ticks are minutes late, add the Rust heartbeat (desktop.md#background-work).
- [ ] Disconnect the network: the footer says *Offline* and capture still works.
