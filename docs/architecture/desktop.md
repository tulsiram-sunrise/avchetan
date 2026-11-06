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
- Position: centered horizontally in the upper third of the work area of the monitor containing the cursor (Rust, `windows.rs`); optional anchors (top-right, near tray) via `tauri-plugin-positioner`; last position persisted.

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
lib.rs            builder: plugins, setup, command list
error.rs          CommandError { code, message }
windows.rs        dock show/hide/toggle + positioning, blur → hide, main window (dock_hide, main_open)
hotkey.rs         global shortcut registration (hotkey_status, hotkey_set)
tray.rs           tray icon + menu (tray_set_pending)
commands/
  db.rs           db_open / db_run / db_values / db_batch / db_rollback  (rusqlite, one connection per window, ADR-0019)
  secrets.rs      secret_get / secret_set / secret_delete  (keyring crate)
  context.rs      previous_window_context, read_clipboard_text   (Phase 6)
  audio.rs        start_recording / stop_recording → wav path    (Phase 7)
```
- Commands return `Result<T, CommandError>` where `CommandError` serializes to `{ code, message }`; the TS side wraps them in typed functions in `apps/desktop/src/native/*.ts` and validates results with Zod.
- Capabilities file (`src-tauri/capabilities/*.json`) grants the minimum permissions per window (the dock can't open arbitrary URLs; HTTP plugin scope limited to configured provider hosts + sync server, plus `localhost` for Ollama).

## Plugins

Phase 2: `global-shortcut`, `autostart` (start at login, on by default the first time only), `single-instance` (second launch shows the dock), `window-state` (main window), `opener` (help links open in the browser, scoped to the guide site). Later: `http` (Phase 3), `positioner` (anchor options), `process`, `updater`. SQLite goes through our own commands, not the `sql` plugin ([ADR-0019](../decisions/0019-desktop-sqlite-own-commands.md)). Secrets use the `keyring` crate (3.x), not `stronghold`. Notifications use the `tauri-winrt-notification` crate directly (`src-tauri/src/notify.rs`), not the `notification` plugin, because a click must open Days on the brief's day; the installed app shows them under its bundle identifier, a dev build under PowerShell's.

## HTTP

Every request from the app (models, Ollama, the hub or server) goes through the `http` plugin, so it is made by Rust rather than the webview, and only to the hosts in the capability's scope. The app sends **no `Origin` header** (`src/platform/native-fetch.ts`, with the plugin's `unsafe-headers` feature): the plugin would otherwise send the window's origin, which is `http://localhost:1420` in a development build but `http://tauri.localhost` once installed, and Ollama refuses the latter with 403. Only the app's own bundled code runs in its windows (CSP), so the feature's extra freedom over headers is not exposed to web content.

## Data layer

- SQLite file in the app data dir (`avchetan.db`), WAL mode.
- Drizzle `sqlite-proxy` driver forwarding to the app's own `db_run`/`db_values` commands (`apps/desktop/src/native/sqlite.ts` → `src-tauri/src/commands/db.rs`), one connection per window ([ADR-0019](../decisions/0019-desktop-sqlite-own-commands.md)). Migrations bundled and run at startup (`openClientStore`) before the UI renders anything that reads data.
- In dev, each capture logs its duration and the rolling p95 at `debug` (`capture committed`).
- Measure the capture path in Phase 2; if IPC overhead pushes it over 10 ms, move the capture transaction into a dedicated Rust command (documented fallback).

## Background work

Runs in the dock webview (always alive): pending processor, sync engine timers, daily brief runner (`services/brief.ts`; the main window asks it with the `brief:make` event and follows `brief:state`, because a brief can take minutes, longer than an action may). WebView2 may throttle timers in hidden windows — Phase 2 must verify timers fire while hidden; if not, drive a 30 s heartbeat event from Rust (`tokio` interval → `emit('tick')`).

## Frontend stack

Vite + React + TypeScript + Tailwind. State: Zustand (UI state), TanStack Query (data reads, invalidated by `logs:changed`/`sync:done` events). Router only in `main` window (TanStack Router or React Router), added when it outgrows the two-view switch in Phase 3. Two Vite entry points: `dock.html`, `main.html`.

## Backups and export

- The dock (it never closes) runs `startDailyBackups` from `@avchetan/db`: on start and then hourly, it asks Rust for today's copy. `backup_create` (`commands/data.rs`) runs `VACUUM INTO` on a connection of its own into `<app data>/backups/avchetan-YYYY-MM-DD.db.partial`, renames it into place and keeps the newest 7. The webview's executor isn't used, because it queues statements during an open transaction and `VACUUM` can't run inside one.
- **Settings → Your data**: *Export everything* builds the files in TypeScript (`store.exportData()` + `exportFiles()`), and `export_write` writes them under `Documents/Avchetan exports/<dated folder>/`. `data_folder_open` opens the backups or exports folder. Rust accepts only plain file names, so the webview can't write outside those folders.

## Packaging

Windows installer via Tauri bundler (NSIS), per-user, in `%LOCALAPPDATA%Avchetan`. App identifier `app.avchetan`. `build:release` adds the hub program and PGlite's folders beside the app ([Releasing](../conventions/releasing.md)). Code signing deferred. Anything that differs between a development and an installed build (the window origin, paths beside the exe) is tried on the installed app before a step is called done.

## Hub mode (Home Hub deployment)

When the user chooses *Home Hub* in the setup wizard ([deployment-modes](deployment-modes.md#2-home-hub)):
- The desktop app launches `apps/server` as a **Tauri sidecar** (`externalBin`: the server built by `build:sidecar` as a Node single executable, with PGlite's folders beside it as resources; PGlite data dir under the app data folder; [ADR-0024](../decisions/0024-hub-sidecar-node-single-executable.md)), restarts it if it crashes, and stops it on quit by closing its stdin (`SHUTDOWN_ON_STDIN_CLOSE=true`), which also stops it cleanly if the app crashes (or keeps it running from the tray if "keep hub running" is on).
- First run: generate `SYNC_TOKEN` → keychain; detect Ollama (`http://localhost:11434/api/tags`), list installed models, suggest slot presets; offer to add a Windows firewall rule for port 8787 on *Private* networks; detect Tailscale and show its hostname.
- Settings → *Hub*: status, port, data folder, logs, backups, embedding backlog (`/v1/status`), *Pair a phone* (QR), *Rotate token*.
- The desktop app itself syncs to `http://localhost:8787` and extracts locally with Ollama.
- Rust surface (`commands/hub.rs`): `hub_status`, `hub_configure` (saves `<app data>/hub/hub.json`: on/off, port, model slots, no secrets, and starts, restarts or stops the process to match) and `hub_import_data` (copies another hub's `pglite-data` into an empty `<app data>/hub/pglite-data`). Rust reads the token (`hub:server:token`) and any provider keys from the keychain and passes them to the process as env vars, with nothing else from the app's environment but what Node needs. It keeps the last 200 log lines for the settings screen. The program is found beside the app's own executable, or in a development build where `build:sidecar` puts it.
