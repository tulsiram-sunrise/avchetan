import type { Cancel, Scheduler } from '../adapters';
import { toAppError } from '../errors';
import type { Logger } from '../logger';

/** `'more'` = there is more work; run again immediately. */
export type LoopRunResult = 'idle' | 'more';

export type LoopOptions = {
  name: string;
  run: () => Promise<LoopRunResult>;
  /** Safety-net polling interval; events should call `wake()` for prompt work. */
  intervalMs: number;
  backoff: { minMs: number; maxMs: number };
  scheduler: Scheduler;
  log: Logger;
  /** Random source for jitter in [0, 1) (injectable for tests). */
  random?: () => number;
};

export type Loop = {
  /** Run now, or once more after the current run finishes (wakes coalesce). */
  wake: () => Promise<void>;
  /** Start interval polling. */
  start: () => void;
  stop: () => void;
  /** Reset backoff, e.g. on a network transition. */
  resetBackoff: () => void;
};

/**
 * Background loop that never runs concurrently with itself (docs/patterns/background-jobs.md).
 * Wakes during a run coalesce into a single follow-up run; failures back off with jitter.
 */
export function createLoop(options: LoopOptions): Loop {
  const random = options.random ?? Math.random;
  let running: Promise<void> | null = null;
  let wakeRequested = false;
  let failures = 0;
  let backoffUntilRetry: Cancel | null = null;
  let cancelInterval: Cancel | null = null;

  const backoffDelay = () => {
    const base = Math.min(options.backoff.maxMs, options.backoff.minMs * 2 ** (failures - 1));
    return Math.round(base / 2 + (base / 2) * random());
  };

  const clearBackoff = () => {
    backoffUntilRetry?.();
    backoffUntilRetry = null;
  };

  async function runUntilIdle(): Promise<void> {
    try {
      let result: LoopRunResult;
      do {
        result = await options.run();
      } while (result === 'more');
      failures = 0;
    } catch (error) {
      failures += 1;
      const delay = backoffDelay();
      options.log.warn('loop run failed', {
        loop: options.name,
        code: toAppError(error).code,
        failures,
        retryInMs: delay,
      });
      clearBackoff();
      backoffUntilRetry = options.scheduler.after(delay, () => {
        backoffUntilRetry = null;
        void wake(); // retry after backoff; errors are handled inside the run
      });
    }
  }

  function wake(): Promise<void> {
    if (running) {
      wakeRequested = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          wakeRequested = false;
          await runUntilIdle();
        } while (wakeRequested && failures === 0);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    wake,
    start() {
      if (cancelInterval) return;
      cancelInterval = options.scheduler.every(options.intervalMs, () => {
        if (!backoffUntilRetry) void wake(); // polling never bypasses an active backoff
      });
    },
    stop() {
      cancelInterval?.();
      cancelInterval = null;
      clearBackoff();
    },
    resetBackoff() {
      failures = 0;
      clearBackoff();
    },
  };
}
