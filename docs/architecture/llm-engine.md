# LLM Engine (`packages/core`)

Provider-agnostic layer for extraction, analysis, embeddings and transcription. Built on the Vercel AI SDK ([ADR-0008](../decisions/0008-vercel-ai-sdk-provider-agnostic.md)). Nothing outside `packages/core` imports a provider SDK.

## Providers

Free options come first ([ADR-0020](../decisions/0020-free-first-provider-adapters.md)). Paid providers are on the roadmap under *Later*.

| Provider id | Package | Auth | Notes |
|---|---|---|---|
| `groq` | `@ai-sdk/groq` | API key | Very low latency; free tier; good extraction slot |
| `ollama` | `@ai-sdk/openai-compatible`, `baseUrl` default `http://localhost:11434/v1` | none | Local/offline. On Android: LAN URL of the desktop |
| `google` | `@ai-sdk/google` | API key | Gemini. The free tier may use content to improve Google's products, so use it with made-up data only |

Each provider is a `ProviderAdapter` (`packages/core/src/providers/adapters/`) registered in `PROVIDER_ADAPTERS`. An adapter holds only what differs between providers: `requiresApiKey`, `local`, `freeTierUsesContent`, `createModel`, and optional `structuredOptions` and `classifyError`. To add a provider: add its id to `LLM_PROVIDERS`, write one adapter, register it.

Besides real providers, a slot can be set to a **routing mode** for devices that can't or shouldn't call a model themselves ([deployment-modes](deployment-modes.md#llm-work-for-the-phone-delegate-to-hub)):
- extraction `delegate` — this device never extracts; the server does it immediately after sync;
- analysis `hub` — Ask questions go to the server's `POST /v1/ask`, which runs the analysis model with server-side tools and streams the answer.

`createModel(slotConfig, deps)` in `packages/core/src/providers/registry.ts` is the **only** factory. It receives an injected `fetch` (desktop passes the `tauri-plugin-http` fetch so calls don't hit webview CORS; mobile passes `expo/fetch`; server passes Node fetch) and an injected `SecretStore`.

## Model slots

| Slot | Purpose | Requirements | Runs on |
|---|---|---|---|
| `extraction` | Raw log → structured result | Fast, cheap, reliable structured output | clients + server fallback |
| `analysis` | Ask mode, daily brief, weekly review | Strong reasoning, tool use, long context | clients (+ server for brief fallback) |
| `embedding` | Vectors for semantic search | Fixed dimension (ADR-0012) | server only |
| `transcription` | Voice → text (Phase 7) | Whisper-class | desktop (local whisper.cpp or cloud), mobile (cloud) |

Slot config (non-secret, stored in `settings`):
```json
{ "extraction": { "provider": "groq", "model": "<model-id>", "temperature": 0, "timeoutMs": 20000 },
  "analysis":   { "provider": "anthropic", "model": "<model-id>", "timeoutMs": 90000 },
  "fallbacks":  { "extraction": [{ "provider": "google", "model": "<model-id>" }] } }
```
- **No model IDs in code.** Suggested pairs live in `packages/core/src/models/presets.json` (data, edited when providers release new models — check provider docs; the names in `original-docs/` are obsolete). Settings UI offers presets plus a free-text model field and a "Test" button.
- **Fallback chain:** if the primary extraction model fails with `llm_unavailable` (not validation, auth or rate limiting), try the next entry. Recorded in `llm_runs`.

## Secrets

`SecretStore` interface: `get(name)`, `set(name, value)`, `delete(name)`; names like `provider:anthropic:apiKey`, `sync:token`.
- Desktop: Rust commands backed by the `keyring` crate (Windows Credential Manager / macOS Keychain / Secret Service). The webview never persists keys; it fetches them per call and does not cache beyond the call.
- Mobile: `expo-secure-store` (Android Keystore-backed).
- Server: env vars `GROQ_API_KEY`, `GOOGLE_API_KEY`, … read once at startup through the validated env schema.
- Manual live check: `pnpm --filter @avchetan/core test:live` reads the same env vars from the terminal and sends one made-up sentence to each configured provider. It never runs in CI.

## Extraction

- Uses the SDK's **structured object output** (JSON-schema-constrained where the provider supports it; tool-call or JSON-mode fallback handled by the SDK) with the `ExtractionResult` Zod schema ([extraction-pipeline §3](extraction-pipeline.md#3-extraction-call)).
- Every structured call goes through `generateStructured` (`packages/core/src/llm/generate-structured.ts`), which owns the fallback chain, the single repair retry and run recording. The SDK's own retries are off (`maxRetries: 0`): the pending processor counts attempts and backs off.
- Errors are mapped by `toLlmError` without keeping the SDK error as `cause`, because SDK errors carry the request body (the user's log content).
- `temperature: 0`. Timeout 20 s default.
- Schema design rules (for cross-provider reliability):
  - Avoid `z.record(z.any())` at the top level — `metrics` is an array of `{key, value}` pairs that the normalizer folds back, plus a typed `exercises` array. Some providers reject open-ended objects in strict mode, and an object of every known key would make the model write dozens of nulls per activity.
  - All fields required-but-nullable rather than optional where strict modes need it (`dueDate: string | null`).
  - Short `.describe()` text on every field; examples belong in the prompt, not the schema.
  - Enums for roles and entity kinds. Categories are **not** an enum (they're dynamic, [ADR-0015](../decisions/0015-dynamic-categories.md)): the schema takes a string and the normalizer resolves it against the category table.
- Prompt files: `packages/core/src/prompts/extraction.v<N>.ts` exporting `{ version, system, buildUser(input) }`. Bump `EXTRACTION_PROMPT_VERSION` on any change that alters output; old versions stay for reproducibility.
- Prompt content outline: role; the current category list (slug, name, description) with the rule "prefer an existing category; propose a new one only if none fits, with a short name and one-line description"; date resolution rules relative to the provided "today" and timezone; metric registry; tag rules (reuse vocabulary, kebab-case, 0–5 tags, no tags that merely restate the category); task rules (verb-first, only forward-looking commitments); entity rules; "if nothing actionable, return skip"; 6–10 compact few-shot examples covering the seed categories, a new-category proposal, multi-item entries, relative dates, mixed languages.

## Analysis (Ask mode, briefs)

Uses `generateText` with tools and multi-step tool calling (max ~6 steps), streaming the final text to the UI.

Read-only tools (Zod-defined in `packages/core/src/analysis/tools/`, implementations injected per app — SQLite implementations on clients, Postgres implementations on the server for `/v1/ask`). `category` arguments are category slugs; `list_categories` lets the model discover them.

| Tool | Args | Backing |
|---|---|---|
| `query_activities` | `category?`, `tags?`, `projectId?`, `from?`, `to?`, `text?`, `limit` | local SQL |
| `aggregate_metrics` | `metric`, `agg` (`sum/avg/min/max/count`), `groupBy` (`day/week/month`), filters | local SQL |
| `query_tasks` | `status` (`open/done/overdue`), `due` range, `tags?`, `entity?` | local SQL |
| `list_tags` | `prefix?` | local SQL |
| `list_categories` | — | local SQL |
| `streaks` | `category?` / `tag?` | local SQL |
| `search_history` | `query`, `from?`, `to?`, `category?`, `limit ≤ 15` | server `/v1/search` (semantic); returns `unavailable` offline |
| `query_entities` / `query_commitments` | `name`, `kind?` | local SQL (Phase 7) |
| `get_logs` | `ids[]` | local SQL — fetch full text for citation |

Rules:
- Tool results are compact JSON (IDs, dates, titles, metrics, truncated text ≤ 500 chars) to keep context small.
- The system prompt requires citing log IDs; the UI renders them as links.
- Analysis tools are **read-only**. Writes happen only through Command mode with user confirmation.
- When offline and the analysis slot is a cloud model: Ask shows "offline — showing local stats" and runs a deterministic fallback (basic SQL summary) where possible.

## Embeddings

Server only. `embedText(texts[])` via the embedding slot. Input = raw log content + its extracted titles and tags (better recall than content alone), hashed (`content_hash`) to skip unchanged rows.

## Observability & cost

Every call records an `llm_runs` row (client) or structured log line (server): purpose, provider, model, latency, token counts, ok/error code. Settings shows a monthly token summary per provider.

## Error taxonomy

| Code | Meaning | Retry? |
|---|---|---|
| `llm_auth` | Invalid/missing key | No — prompt user |
| `llm_rate_limit` | 429 | Yes, honor `retry-after` |
| `llm_unavailable` | 5xx, timeout, network | Yes; try fallback model |
| `llm_invalid_output` | Schema validation failed after repair retry | Counts as attempt |
| `llm_refused` | Safety refusal / empty | Mark error, no auto retry |
| `llm_context_overflow` | Too long | Trim vocabulary and retry once |
