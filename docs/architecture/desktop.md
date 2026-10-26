# Desktop App (`apps/desktop`, Tauri v2)

Primary target: **Windows 11**. macOS/Linux should work where Tauri does, but are not tested until needed.

## Principles

- Rust is a **thin native shell**: windows, hotkeys, tray, keychain, active-window/clipboard, audio (later). All business logic is TypeScript in the webview using `@avchetan/*` packages.
- The dock must appear in < 100 ms after the hotkey; the webview stays alive while hidden (never destroyed).

## Windows

| Label | Purpose | Config |
|---|---|---|
| `dock` | Capture / Ask / Command HUD | ~520×400 (grows for Ask answers up to ~520×640), `decorations: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `visible: false`, `shadow: false` (CSS draws it) |
| `main` | Full window: timeline, tasks, tags, people, settings | Normal decorated, resizable, taskbar visible, created on demand, hidden (not closed) on close |

- Visual: frosted glass (`backdrop-filter: blur`) with a solid fallback (Windows transparency + blur can be inconsistent; Mica/acrylic via `window-vibrancy` crate is an option), rounded corners, subtle border, respects light/dark.
- Position: centered on the monitor containing the cursor by default; optional anchors (top-right, near tray) via `tauri-plugin-positioner`; last position persisted.

## Summoning & dismissal

- **Global hotkey** (`tauri-plugin-global-shortcut`): default **`Ctrl+Shift+Space`** — configurable. (`Alt+Space` from the original spec conflicts with the Windows window menu and PowerToys Run; allowed as an opt-in.) Registration failure → notification + settings prompt.
- Hotkey handler (Rust): (1) capture previous foreground window context (Phase 6), (2) show + focus dock, (3) emit `dock:shown` with context to the webview. If already visible and focused → hide.
- **Tray** (`tauri` tray API): left-click toggles dock; right-click menu: *Open Avchetan* (main window), *Sync now*, *Pending: N* (disabled label), *Preferences*, *Pause capture context*, *Quit*. Tooltip shows pending count and last sync time.
- **Auto-hide on blur**: on `blur` event → hide after 100 ms unless a native dialog is open or "pin dock" is toggled. The draft (input text, mode) is kept in the webview state and persisted to `settings` every 500 ms so it survives restarts.
- `Esc` → hide. `Enter` → submit. `Shift+Enter` → newline. `Ctrl+Enter` in Ask answer → open in main window.

## Dock UI

- Single input with mode indicator (Capture · Ask `?` · Command `/`).
- Below: last ~5 captures with status badges (pending / processed / error), each expandable to show extracted children.
- Ask answers stream into a panel with citation chips.
- Footer: offline indicator, pending count, sync state.
- All keyboard-driven; mouse optional.

## Rust surface (`src-tauri/src/`)

```
lib.rs            builder: plugins, setup, tray, shortcuts
windows.rs        dock show/hide/toggle, positioning
commands/
  secrets.rs      secret_get / secret_set / secret_delete  (keyring crate)
  context.rs      previous_window_context, read_clipboard_text   (Phase 6)
  audio.rs        start_recording / stop_recording → wav path    (Phase 7)
```
- Commands return `Result<T, CommandError>` where `CommandError` serializes to `{ code, message }`; the TS side wraps them in typed functions in `apps/desktop/src/native/*.ts` and validates results with Zod.
- Capabilities file (`src-tauri/capabilities/*.json`) grants the minimum permissions per window (the dock can't open arbitrary URLs; HTTP plugin scope limited to configured provider hosts + sync server, plus `localhost` for Ollama).

## Plugins

`global-shortcut`, `sql` (SQLite), `http`, `positioner`, `notification`, `autostart` (start at login, default on), `single-instance` (second launch focuses the dock), `window-state` (main window), `process`, `updater` (later). Secrets via the `keyring` crate, not `stronghold`.

## Data layer

- SQLite file in the app data dir (`avchetan.db`), WAL mode.
- Drizzle `sqlite-proxy` driver forwarding to `tauri-plugin-sql` (`apps/desktop/src/db/driver.ts`). Migrations bundled and run at startup before the UI renders anything that reads data.
- Measure the capture path in Phase 2; if IPC overhead pushes it over 10 ms, move the capture transaction into a dedicated Rust command (documented fallback).

## Background work

Runs in the dock webview (always alive): pending processor, sync engine timers, daily brief scheduler. WebView2 may throttle timers in hidden windows — Phase 2 must verify timers fire while hidden; if not, drive a 30 s heartbeat event from Rust (`tokio` interval → `emit('tick')`).

## Frontend stack

Vite + React + TypeScript + Tailwind. State: Zustand (UI state), TanStack Query (data reads, invalidated by `logs:changed`/`sync:done` events). Router only in `main` window (TanStack Router or React Router). Two Vite entry points: `dock.html`, `main.html`.

## Packaging

Windows installer via Tauri bundler (NSIS). App identifier `app.avchetan`. Code signing deferred.

## Hub mode (Home Hub deployment)

When the user chooses *Home Hub* in the setup wizard ([deployment-modes](deployment-modes.md#2-home-hub)):
- The desktop app launches `apps/server` as a **Tauri sidecar** (`externalBin`: the server bundled as a single Node executable; PGlite data dir under the app data folder), restarts it if it crashes, and stops it on quit (or keeps it running from the tray if "keep hub running" is on).
- First run: generate `SYNC_TOKEN` → keychain; detect Ollama (`http://localhost:11434/api/tags`), list installed models, suggest slot presets; offer to add a Windows firewall rule for port 8787 on *Private* networks; detect Tailscale and show its hostname.
- Settings → *Hub*: status, port, data folder, logs, backups, embedding backlog (`/v1/status`), *Pair a phone* (QR), *Rotate token*.
- The desktop app itself syncs to `http://localhost:8787` and extracts locally with Ollama.
- Rust surface: `hub_start`, `hub_stop`, `hub_status` commands (`commands/hub.rs`) wrapping the sidecar process; logs piped to the app log.
