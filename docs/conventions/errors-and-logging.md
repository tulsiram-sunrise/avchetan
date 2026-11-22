# Errors & Logging

## Errors

- Base class `AppError` in `@avchetan/shared/errors` with a stable string `code`, `message`, optional `cause`, optional `details`. Subclasses per domain: `DbError`, `SyncError`, `LlmError`, `NativeError`, `ValidationError`.
- Codes are `snake_case` and stable (UI and retry logic switch on them). LLM codes: see [llm-engine](../architecture/llm-engine.md#error-taxonomy).
- **Inside a module:** throw `AppError`s.
- **At boundaries** (IPC wrappers, HTTP client/handlers, LLM calls, background jobs): convert to `Result<T, AppError>` (`ok()`/`err()` helpers) or to the HTTP error shape. Background loops never crash on a single item — they record the error on that item and continue.
- **Capture path:** may only fail if the local DB write fails. That failure is shown loudly (toast + tray icon state) and the draft is kept.
- No empty `catch {}`. If an error is intentionally ignored, log it at `debug` with the reason.
- Never put user content, prompts, or secrets into error messages (they end up in logs and `last_error`).
- **Every code a user can see is in `ERROR_HELP`** (`packages/shared/src/error-help.ts`): its guide section in [troubleshooting](../user-guide/troubleshooting.md) (`null` when the message is the whole fix, such as an empty name), and a plain message when the thrown one is written for developers. The apps show errors through `describeError()` and `HelpLink`, which resolve a code through it; an unknown code links to `other_errors`. A new code needs its entry and, if it has a section, the section, or `pnpm errors:check` fails in CI. The check finds codes in TS error constructors, `helpCode:` rows, fixed `HelpLink` codes, Rust strings, LLM codes and the server's startup hints. It reads **every** `"snake_case"` string literal in Rust as an error code, so a new non-error string of that shape (a SQLite pragma name, for example) goes in `RUST_NOT_CODES` in `tooling/scripts/check-error-codes.ts`. Run `pnpm errors:check` before pushing Rust changes.

## Logging

- `createLogger(scope)` from `@avchetan/shared/logger` → `{ debug, info, warn, error }` with structured fields: `log.info('push done', { acked: 12, rejected: 0, ms: 140 })`.
- Implementations:
  - **Desktop:** one rotating file, `avchetan.log` in the app's log folder (`%LOCALAPPDATA%\<identifier>\logs`; about 1 MB a file, 4 old files kept, UTC times), through `tauri-plugin-log` (`log_plugin` in `src-tauri/src/lib.rs`). The Rust shell logs with the `log` crate (`log::warn!`, never `eprintln!`); the webviews' logger writes there through `src/platform/log-sink.ts`; all of the built-in hub's output goes there under the `hub` target, at the level its first word names (other output, such as a crash's stack, at `warn`, with the user's home folder shown as `~`). Info and up in a release build, debug and the console too in development. **Settings → General → Open log folder.**
  - **Mobile:** the last 2,000 records in memory (an hour of the detailed log) (`src/platform/app-log.ts`, imported first by `app/_layout.tsx`), shown, shared and cleared in **More → Log**; nothing written to storage, gone when Android closes the app. Console too in development.
  - **Server:** one line per record, `LEVEL [scope] message {fields as JSON}` (`apps/server/src/log-sink.ts`): warnings and errors on stderr, the rest on stdout (`docker logs`, `journalctl` and the desktop add the time).
- **Unexpected errors** are logged with `errorFields(error)` from `@avchetan/shared`: the `code`, the error's kind (`TypeError`), a Node system code (`EADDRINUSE`) and **where it was thrown**, the first stack frame in our own code as a workspace-relative `name (packages/core/src/file.ts:12:5)`, never a folder above the workspace. **Never `error.message`**: a failed parse quotes its input, a failed request its URL. The hub and the server image are built with source maps (`--enable-source-maps`), so their stacks name our source files; a desktop or phone release names its bundle (`index-AbC12.js:1:52817`), which a build of the same tag with source maps turns back into a file and line.
- **Every error the user sees is logged**, in the same log as everything else, so the steps before it are next to it. Each app's query client logs a failed read (`read failed`, with the key's first part only) or action (`action failed`) at `error` with `errorFields`; the PC also logs the window's `error` and `unhandledrejection` events, the phone React Native's global handler. Errors a screen catches and shows itself are covered by `HelpLink`, which logs `error shown {code}` at `warn` (once a minute per code, for a banner that stays). Model failures carry the provider and HTTP status in `details`.
- Levels: `error` (needs attention), `warn` (degraded, recovered), `info` (lifecycle: sync cycles, jobs, startup), `debug` (details: each request, sync step and entry organized). `debug` is on in development, and for an hour with **Detailed log for 1 hour** (**Settings → General** on the PC, **More → Log** on the phone). That setting is a per-device time (`log.detailedUntil`, core `diagnostics/detailed-log.ts`); `createDetailedLogControl` (shared) raises each JS context's level until then and checks each minute to drop it again. On the PC each window follows it and tells the shell (`log_set_detailed`), whose log filter keeps `debug` records only while it is on and which sends `log-level detailed` or `log-level normal` to the built-in hub's stdin (`apps/server/src/hub-input.ts`). Requests are logged by `withRequestLog` (shared): method, host, path, status and duration, never the query or body.
- **Privacy:** never log log content, task titles, prompts, model responses, API keys, tokens, clipboard or window titles at `info`+. `debug` may include content only when the developer setting "verbose content logging" is enabled locally; it is never enabled on the server.
- Always include IDs (`rawLogId`, `requestId`, `deviceId`), counts and durations instead.
- No `console.log` in committed code (Biome rule).

## Surfacing to the user

| Situation | Surface |
|---|---|
| Capture failed | Toast in dock + keep draft |
| Extraction errors | Badge + Errors list with retry |
| Invalid API key / sync token | Persistent banner in settings + tray tooltip |
| Sync failing > 15 min while online | Footer indicator turns amber with last error code |
| Server reachable but rejects rows | "Sync issues" list (rows with ≥ 10 attempts) |
