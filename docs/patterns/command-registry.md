# Pattern: Command registry (Phase 6)

**Use when:** adding a dock `/command`, a mobile quick action, or an action the analysis model proposes.

## Shape

```ts
// packages/core/src/commands/registry.ts (illustrative)
export const commands = defineCommands({
  done: {
    summary: 'Complete an open task',
    args: z.object({ query: z.string().min(1) }),
    parse: (text) => ({ query: text }),                       // "/done foam roll"
    resolve: async ({ query }, ctx) => ctx.queries.tasks.fuzzyOpen(query, 5), // candidates for confirmation
    requiresConfirm: (candidates) => candidates.length !== 1,
    execute: async (taskId: string, ctx) => ctx.repos.task.complete(taskId),
  },
  sync:  { summary: 'Sync now', args: z.object({}), execute: (_, ctx) => ctx.sync.runNow(), requiresConfirm: () => false },
  brief: { summary: 'Generate today\'s brief', … },
  move:  { summary: 'Move tasks (e.g. overdue → tomorrow)', …, requiresConfirm: () => true },
});
```

## Rules

- Deterministic commands first; LLM interpretation is a fallback: unknown `/text` → the extraction-slot model maps it to `{ command, args }` constrained by the registry schema → **always confirmed** before execution.
- Every write a command performs goes through repositories (outbox, LWW as usual).
- Destructive or bulk commands always require confirmation and offer undo (soft delete makes undo cheap).
- The dock autocompletes command names and shows `summary`.
