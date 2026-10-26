# Pattern: Repository write with outbox

**Use when:** inserting, updating or soft-deleting a row in any synced table.

**Why:** sync correctness depends on (a) `updated_at`/`updated_by_device` being bumped with the monotonic clock and (b) the outbox pointer being written atomically with the data. Doing this by hand in feature code is how changes silently fail to sync.

## Shape

```ts
// packages/db/src/repos/create-repo.ts (illustrative)
export function createSyncedRepo<T extends SyncedTable>(table: T, deps: RepoDeps) {
  const stamp = (row: Partial<Row<T>>, isInsert: boolean) => {
    const now = deps.clock.now();
    return {
      ...row,
      ...(isInsert ? { id: row.id ?? deps.newId(), createdAt: now } : {}),
      updatedAt: now,
      updatedByDevice: deps.deviceId,
    };
  };

  return {
    async upsert(tx: Tx, row: InsertRow<T>) {
      const stamped = stamp(row, true);
      await tx.insert(table).values(stamped).onConflictDoUpdate({ target: table.id, set: stamped });
      await enqueueOutbox(tx, tableName(table), stamped.id, deps.clock.now());
      return stamped;
    },
    async update(tx: Tx, id: string, patch: Partial<Row<T>>) { /* stamp(patch,false) + enqueue */ },
    async softDelete(tx: Tx, id: string) { /* update deletedAt = now + enqueue */ },
  };
}

// usage in a domain repo — callers pass a tx so multi-row operations stay atomic
export const taskRepo = (deps: RepoDeps) => {
  const base = createSyncedRepo(tasks, deps);
  return {
    complete: (id: string) =>
      deps.db.transaction((tx) => base.update(tx, id, { completedAt: deps.clock.now() })),
  };
};
```

`enqueueOutbox` = `INSERT INTO sync_outbox(table_name, record_id, enqueued_at, attempts) VALUES (…, 0) ON CONFLICT(table_name, record_id) DO UPDATE SET enqueued_at = excluded.enqueued_at`.

After the transaction commits, the repo emits `logs:changed` / `<table>:changed` on the event bus and calls `sync.schedule()` (debounced). Never inside the transaction.

## Pitfalls

- Writing a synced table with `db.insert(...)` outside a repo → never syncs. (Lint: restrict imports of table objects from `@dhyan/db/schema` to `packages/db` internals.)
- Awaiting network inside the transaction.
- Forgetting cascades on soft delete (raw log → derived rows → tag links/mentions).
- Pull application must use `applyRemote`, which does LWW and **does not** enqueue.
