/** UTC instant as stored everywhere: `2026-10-26T14:03:11.402Z`. */
export type UtcInstant = string;

export interface Clock {
  /** Current instant, strictly greater than any instant this clock issued before. */
  now(): UtcInstant;
  /** Last instant issued (for persisting in `sync_state.clock_last`), or null. */
  lastIssued(): UtcInstant | null;
}

export type MonotonicClockOptions = {
  /** Last instant issued in a previous session, so restarts stay monotonic. */
  restoredLast?: UtcInstant | null;
  /** Wall-clock source in epoch milliseconds (injectable for tests). */
  source?: () => number;
  /** Called with every issued instant; use it to persist `clock_last`. */
  onIssue?: (instant: UtcInstant) => void;
};

/**
 * Monotonic per-device clock: `max(wallClock, lastIssued + 1ms)`.
 * LWW sync compares `updated_at` values, so a device must never issue the same or
 * an earlier timestamp twice, even if the wall clock steps backwards.
 */
export function createMonotonicClock(options: MonotonicClockOptions = {}): Clock {
  const source = options.source ?? (() => Date.now());
  let lastMs = options.restoredLast ? Date.parse(options.restoredLast) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(lastMs)) {
    throw new TypeError(`Invalid restoredLast instant: ${options.restoredLast}`);
  }
  let last: UtcInstant | null = options.restoredLast ?? null;

  return {
    now() {
      const nextMs = Math.max(source(), lastMs + 1);
      lastMs = nextMs;
      last = new Date(nextMs).toISOString();
      options.onIssue?.(last);
      return last;
    },
    lastIssued() {
      return last;
    },
  };
}

const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True for the exact persisted format (ms precision, `Z`), which sorts chronologically as text. */
export function isUtcInstant(value: string): value is UtcInstant {
  return UTC_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** Add milliseconds to an instant (lease expiry, backoff). */
export function addMs(instant: UtcInstant, ms: number): UtcInstant {
  return new Date(Date.parse(instant) + ms).toISOString();
}
