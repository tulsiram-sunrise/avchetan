# Pattern: Analysis tools

**Use when:** giving the analysis model access to user data (Ask mode, briefs, weekly review).

## Shape

Tool **definitions** (name, description, Zod args, result schema) live in `packages/core/src/analysis/tools/`. **Implementations** are injected so the same definitions work on desktop, mobile and server.

```ts
// definition (platform-free)
export const queryActivitiesTool = defineAnalysisTool({
  name: 'query_activities',
  description: 'Find logged activities by category, tags, project and local date range. Use for exact lookups and lists.',
  args: z.object({
    category: categorySlugSchema.nullable(),      // dynamic categories: a slug, resolved via list_categories
    tags: z.array(z.string()).max(5).nullable(),
    from: localDateSchema.nullable(), to: localDateSchema.nullable(),
    limit: z.number().int().min(1).max(50),
  }),
  result: z.object({ items: z.array(activitySummarySchema), truncated: z.boolean() }),
});

// wiring (per app)
const tools = buildAnalysisTools({
  query_activities: (args) => queries.activities.search(db, args),   // local SQL
  search_history: (args) => apiClient.search(args),                   // server; returns { unavailable: true } offline
  …
});
```

## Rules

- Each tool has a SQLite implementation (clients) and a Postgres implementation (server, for `POST /v1/ask` in Home Hub / Cloud). Both live in `packages/db/src/queries/` and share one contract test suite.

- **Read-only.** No analysis tool writes. Actions are proposed as text/action chips and executed through the [command registry](command-registry.md) with confirmation.
- Results are compact and bounded: summaries + IDs, text truncated (≤ 500 chars), lists capped with a `truncated` flag. The model can fetch full text via `get_logs(ids)`.
- Descriptions say *when* to use the tool (SQL for numbers/dates/tags; semantic search for fuzzy recall).
- Every answer must cite log/activity IDs; the UI resolves them to links.
- Tool errors return `{ error: code }` to the model (so it can adapt) — never throw through the SDK loop.
- Cap steps (≈ 6) and total tool-result tokens per question.
