# API Conventions (server HTTP + Tauri IPC)

## HTTP (server)

- Versioned prefix `/v1`. Breaking changes → `/v2` + protocol header bump.
- JSON only, `camelCase` keys, UTF-8. Instants as ISO strings, local dates as `YYYY-MM-DD`.
- Request and response bodies are defined as Zod schemas in `@dhyan/sync/protocol` (sync) or `apps/server/src/routes/*.schema.ts` (others) and validated on **both** sides.
- Auth: `Authorization: Bearer <token>`; device: `X-Dhyan-Device`; protocol: `X-Dhyan-Protocol`.
- Every response carries `X-Request-Id`; server logs include it.
- Methods: `GET` for reads with no body, `POST` for everything else (no PUT/PATCH/DELETE needed — sync carries tombstones).

### Error shape

```json
{ "error": { "code": "validation", "message": "Human-readable summary", "details": { } , "requestId": "…" } }
```

| HTTP | `code` examples |
|---|---|
| 400 | `validation`, `bad_request` |
| 401 | `unauthorized` |
| 403 | `unknown_device` |
| 409 | `conflict` (rare; LWW losses are not errors) |
| 413 | `payload_too_large` |
| 426 | `protocol_unsupported` |
| 429 | `rate_limited` (+ `Retry-After`) |
| 500 | `internal` (no stack traces in responses) |
| 503 | `unavailable` (DB down, embedding slot not configured) |

### Limits

Push ≤ 500 rows / 2 MB; pull page ≤ 500 rows; search `limit ≤ 15`; request timeout 30 s.

## Tauri IPC

- Rust commands return `Result<T, CommandError>`; `CommandError` serializes as `{ code, message }`.
- The webview never calls `invoke` directly from components: typed wrappers in `apps/desktop/src/native/*.ts` call `invoke`, validate the result with Zod and convert errors to `AppError`.
- Events Rust → JS use `domain:event` names with Zod-validated payloads (`dock:shown { context? }`, `tick`).
- Capabilities grant the minimum permissions per window.

## Client HTTP usage

- All server calls go through `packages/sync`'s `ApiClient` (injected fetch, base URL, token from `SecretStore`, timeout, request ID, error mapping). No ad-hoc `fetch` to the server elsewhere.
- LLM provider HTTP goes only through `@dhyan/core` providers.
