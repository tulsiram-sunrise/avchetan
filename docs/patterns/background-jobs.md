# Pattern: Background jobs

**Use when:** anything runs periodically or in response to events: pending processor, sync engine, daily brief scheduler, server workers.

## Shape

```ts
// packages/shared/src/jobs/single-flight-loop.ts (illustrative)
export function createLoop(opts: {
  name: string;
  run: () => Promise<'idle' | 'more'>;   // 'more' = immediately run again
  intervalMs: number;                    // safety-net polling
  backoff: { minMs: number; maxMs: number };
  scheduler: Scheduler; log: Logger;
}) {
  let running = false, wakeRequested = false;
  async function tick() {
    if (running) { wakeRequested = true; return; }
    running = true;
    try {
      let r: 'idle' | 'more';
      do { r = await opts.run(); } while (r === 'more');
      resetBackoff();
    } catch (e) { opts.log.warn('loop failed', { name: opts.name, code: codeOf(e) }); scheduleBackoff(); }
    finally { running = false; if (wakeRequested) { wakeRequested = false; void tick(); } }
  }
  return { wake: tick, start: () => opts.scheduler.every(opts.intervalMs, tick) };
}
```

## Rules

- **Single-flight:** a loop never runs concurrently with itself; wakes during a run coalesce into one follow-up run.
- **Event-driven first, polling as safety net:** wake on the relevant event (capture, reconnect, sync done), poll at a modest interval.
- **Per-item isolation:** one bad item records its error and the loop continues.
- **Bounded work per run** (batch sizes) so the UI stays responsive and mobile background budgets are respected.
- **Backoff** with jitter on loop-level failures; reset on success or network change.
- **Idempotent work:** any run may be interrupted (app quit, OS kill) at any point; correctness relies on transactions, leases and deterministic IDs, not on completion.
- Scheduled-time jobs (daily brief) compute "due" from persisted state (`last_brief_date`), not from timers firing exactly — so a device that was asleep at 21:00 catches up on wake (if still the same local day, else the server fallback covers it).
