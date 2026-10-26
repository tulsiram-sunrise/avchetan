# Naming

| Thing | Convention | Example |
|---|---|---|
| Packages | `@avchetan/<name>` | `@avchetan/core` |
| Files & folders | `kebab-case` | `pending-processor.ts`, `capture-sheet.tsx` |
| React components | `PascalCase` | `CaptureSheet` |
| Hooks | `useXxx` | `useOpenTasks` |
| Zustand stores | `useXxxStore` in `xxx-store.ts` | `useDockStore` |
| Functions / variables | `camelCase`, verbs for functions | `resolveDueDate`, `pendingCount` |
| Constants | `SCREAMING_SNAKE_CASE` for true constants | `EXTRACTION_PROMPT_VERSION` |
| Types | `PascalCase`, no `I` prefix | `RawLog`, `SecretStore` |
| Zod schemas | `camelCase` + `Schema` | `extractionResultSchema`; type `ExtractionResult` |
| Repositories | `<entity>Repo` | `rawLogRepo`, `taskRepo` |
| Adapters (interfaces) | noun | `SqlDriver`, `SecretStore`, `NetworkMonitor` |
| Adapter impls | `<Platform><Interface>` | `TauriSecretStore`, `ExpoSecretStore` |
| DB tables | plural `snake_case` | `raw_logs`, `entity_tags` |
| DB columns | `snake_case`; TS field `camelCase` | `logged_date` ↔ `loggedDate` |
| Timestamps | `*_at` (UTC instant) | `captured_at`, `completed_at` |
| Local dates | `*_date` (`YYYY-MM-DD`) | `logged_date`, `due_date` |
| Booleans | `is_*` / `has_*` | `is_inferred`, `is_user_edited` |
| Enum values | lowercase `snake_case` strings | `pending_llm`, `owed_to` |
| Metric keys | `snake_case` with unit suffix | `duration_min`, `weight_kg` |
| Tags | lowercase `kebab-case`, `/` for hierarchy | `health/injuries/shoulder-pain` |
| HTTP paths | `/v1/<resource>/<action>` kebab | `/v1/sync/push` |
| JSON on the wire | `camelCase` keys | `updatedByDevice` |
| Env vars | `SCREAMING_SNAKE_CASE` | `SYNC_TOKEN` |
| Events (in-app bus / Tauri) | `domain:event` | `logs:changed`, `sync:done`, `dock:shown` |
| Tauri commands (Rust) | `snake_case` | `secret_get` |
| Secret names | `area:scope:name` | `provider:anthropic:apiKey` |
| Settings keys | `dot.case` | `slots.extraction`, `dock.hotkey` |
| Prompt files | `<purpose>.v<N>.ts` | `extraction.v1.ts` |
| Migrations | drizzle-kit generated, prefixed by dialect folder | `migrations/sqlite/0003_*.sql` |
| ADRs | `NNNN-kebab-title.md` | `0004-outbox-sync-lww.md` |
| Tests | `<file>.test.ts` beside source; integration in `test/` | `lww.test.ts` |
