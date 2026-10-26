# Pattern: Processing lease

**Use when:** a background worker processes a synced row that another worker (another loop on the same device, the server fallback) could also pick up.

**Why:** avoids wasted LLM calls and racing writes. Deterministic IDs make duplicates harmless; leases make them rare.

## Shape

Fields on the row: `processing_lease_owner`, `processing_lease_until`, `processing_attempts`, `next_attempt_at`.

**Client (SQLite, single process):**
```ts
// claim inside one transaction; the single-flight loop guarantees no local race
const claimed = await store.write(async (tx) => {
  const row = await nextClaimable(tx, { deviceId, now });       // WHERE status='pending_llm' AND origin=self AND lease expired …
  if (!row) return null;
  await rawLogBase.update(tx, row.id, {
    processingLeaseOwner: deviceId,
    processingLeaseUntil: addMs(now, 120_000),
    processingAttempts: row.processingAttempts + 1,
  });
  return row;
});
```
**Server (Postgres, possibly concurrent):** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` inside `withSyncWrite` ([extraction-pipeline §5](../architecture/extraction-pipeline.md#5-server-fallback)).

## Rules

- Lease duration > worst-case processing time (client 2 min, server 5 min). On completion or failure, clear the lease in the same transaction as the result.
- Leases are synced fields: a device seeing a server lease that hasn't expired leaves the row alone, and vice versa.
- Expired leases are free to claim — crash recovery needs nothing else.
- The *origin device* rule (only process your own captures) is the primary partition; leases handle the edges (server fallback, "retry here").
- Attempts cap + backoff via `next_attempt_at`; network failures don't consume attempts.

## Pitfalls

- Holding a transaction open during the LLM call. Claim → commit → call LLM → new transaction to apply.
- Using wall-clock comparisons across devices for lease expiry — acceptable because leases are coarse (minutes) and clock skew is bounded by the push validation (±5 min); keep lease durations well above that.
