# Errors & Logging

## Errors

- Base class `AppError` in `@dhyan/shared/errors` with a stable string `code`, `message`, optional `cause`, optional `details`. Subclasses per domain: `DbError`, `SyncError`, `LlmError`, `NativeError`, `ValidationError`.
- Codes are `snake_case` and stable (UI and retry logic switch on them). LLM codes: see [llm-engine](../architecture/llm-engine.md#error-taxonomy).
- **Inside a module:** throw `AppError`s.
- **At boundaries** (IPC wrappers, HTTP client/handlers, LLM calls, background jobs): convert to `Result<T, AppError>` (`ok()`/`err()` helpers) or to the HTTP error shape. Background loops never crash on a single item — they record the error on that item and continue.
- **Capture path:** may only fail if the local DB write fails. That failure is shown loudly (toast + tray icon state) and the draft is kept.
- No empty `catch {}`. If an error is intentionally ignored, log it at `debug` with the reason.
- Never put user content, prompts, or secrets into error messages (they end up in logs and `last_error`).
- User-facing messages are mapped from codes in the UI layer (`errorMessages[code]`), not taken from `error.message`.

## Logging

- `createLogger(scope)` from `@dhyan/shared/logger` → `{ debug, info, warn, error }` with structured fields: `log.info('push done', { acked: 12, rejected: 0, ms: 140 })`.
- Implementations: desktop → console in dev + rotating file via `tauri-plugin-log` in prod; mobile → console (dev) + in-memory ring buffer viewable in settings; server → pino JSON to stdout.
- Levels: `error` (needs attention), `warn` (degraded, recovered), `info` (lifecycle: sync cycles, jobs, startup), `debug` (details, dev only).
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
