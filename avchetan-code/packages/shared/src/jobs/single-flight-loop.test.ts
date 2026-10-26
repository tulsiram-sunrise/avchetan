import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger';
import { ManualScheduler } from '../testing';
import { createLoop, type LoopRunResult } from './single-flight-loop';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(run: () => Promise<LoopRunResult>) {
  const scheduler = new ManualScheduler();
  const loop = createLoop({
    name: 'test',
    run,
    intervalMs: 60_000,
    backoff: { minMs: 1_000, maxMs: 8_000 },
    scheduler,
    log: createLogger('test'),
    random: () => 1, // no jitter reduction: delay = base
  });
  return { loop, scheduler };
}

describe('createLoop', () => {
  it('reruns immediately while the run reports more work', async () => {
    const results: LoopRunResult[] = ['more', 'more', 'idle'];
    let calls = 0;
    const { loop } = setup(async () => {
      calls += 1;
      return results.shift() ?? 'idle';
    });
    await loop.wake();
    expect(calls).toBe(3);
  });

  it('never runs concurrently and coalesces wakes into one follow-up run', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const gate = deferred();
    const { loop } = setup(async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) await gate.promise;
      active -= 1;
      return 'idle';
    });

    const first = loop.wake();
    void loop.wake();
    void loop.wake();
    void loop.wake();
    gate.resolve();
    await first;

    expect(maxActive).toBe(1);
    expect(calls).toBe(2);
  });

  it('backs off exponentially after failures, capped at maxMs', async () => {
    let calls = 0;
    const { loop, scheduler } = setup(async () => {
      calls += 1;
      throw new Error('offline');
    });

    await loop.wake();
    expect(calls).toBe(1);

    scheduler.advance(999);
    await Promise.resolve();
    expect(calls).toBe(1);

    for (const delay of [1_000, 2_000, 4_000, 8_000, 8_000]) {
      const before = calls;
      scheduler.advance(delay);
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toBe(before + 1);
    }
  });

  it('polls on the interval but not during a backoff', async () => {
    let fail = true;
    let calls = 0;
    const { loop, scheduler } = setup(async () => {
      calls += 1;
      if (fail) throw new Error('offline');
      return 'idle';
    });
    loop.start();

    await loop.wake(); // fails → backoff of 1s scheduled
    fail = false;
    scheduler.advance(1_000); // backoff retry succeeds
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);

    scheduler.advance(59_000); // first interval tick at 60s
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(3);

    loop.stop();
    scheduler.advance(120_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(3);
  });

  it('resetBackoff cancels a pending retry', async () => {
    let calls = 0;
    const { loop, scheduler } = setup(async () => {
      calls += 1;
      throw new Error('offline');
    });
    await loop.wake();
    loop.resetBackoff();
    scheduler.advance(10_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });
});
