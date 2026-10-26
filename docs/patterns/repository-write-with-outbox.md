# Pattern: Repository write with outbox

**Use when:** inserting, updating or soft-deleting a row in any synced table.

**Why:** sync correctness depends on (a) `updated_at`/`updated_by_device` being bumped with the monotonic clock and (b) the outbox pointer being written atomically with the data. Doing this by hand in feature code is how changes silently fail to sync.

## Shape

Generic helpers in `packages/db/src/client/synced.ts` do the stamping and outbox work; domain repositories in `client/repos/*` add validation and rules on top. Every repository method takes the transaction handle, so callers decide what is atomic.

```ts
// packages/db/src/client/repos/tasks.ts (simplified)
export function tasksRepo(deps: RepoDeps) {
  return {
    create: (tx: Tx, input: NewTask) =>
      insertSynced(tx, deps, tasks, { title: input.title.trim(), origin: 'user', /* … */ }),
    complete: (tx: Tx, id: string) =>
      updateSynced(tx, deps, tasks, id, { completedAt: deps.clock.now() }),
    async softDelete(tx: Tx, id: string) {
      await softDeleteLinksTo(tx, deps, 'task', [id]); // cascade first
      await softDeleteSynced(tx, deps, tasks, [id]);
    },
  };
}

// usage (app or @avchetan/core): one transaction for several writes
await store.write(async (tx) => {
  const log = await store.repos.rawLogs.capture(tx, input);
  await store.repos.tasks.create(tx, { title: 'Buy milk', rawLogId: log.id });
});
```

| Helper | Use for |
|---|---|
| `insertSynced` | New rows (`newId()` unless an `id` is given) |
| `updateSynced` | Changing an existing row (`not_found` if missing) |
| `upsertSynced` | Rows with derived IDs that may already exist (also resurrects tombstones) |
| `ensureSynced` | Insert only if the ID doesn't exist yet — never overwrites (seeds) |
| `softDeleteSynced` | Deletes (tombstones) |

`enqueueOutbox` = `INSERT INTO sync_outbox … ON CONFLICT(table_name, record_id) DO UPDATE SET enqueued_at = excluded.enqueued_at, attempts = 0` — ten edits to one row leave one pointer.

After the transaction commits, the caller (app service layer) emits `logs:changed` / `<table>:changed` on the event bus and calls `sync.schedule()` (debounced). Never inside the transaction.

## Pitfalls

- Writing a synced table with `tx.insert(...)` outside the repositories → never syncs.
- Calling `store.write` inside a `store.write` callback → waits on itself forever. Pass the `tx` down instead.
- Awaiting network inside the transaction.
- Forgetting cascades on soft delete (raw log → derived rows → tag links/mentions).
- Pull application must use `store.sync.applyRemote`, which does LWW and **does not** enqueue.
