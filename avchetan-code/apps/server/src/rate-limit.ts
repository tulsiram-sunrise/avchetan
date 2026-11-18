const WINDOW_MS = 60_000;

/** Requests a device may make in a minute: everything but pulls. */
export const MAX_REQUESTS = 60;
/**
 * Pulls have their own, larger budget: a phone's first download of a long history needs hundreds
 * of pages in a row (50,000 entries are about 150,000 rows), and pulling only reads what the
 * token already opens. At 60 the download was refused after a minute and never finished.
 */
export const MAX_PULLS = 600;
/**
 * Requests from one network address in a minute, signed in or not, whatever device they name:
 * a few devices behind one home router fit, a token guesser or a script making up device IDs
 * doesn't.
 */
export const MAX_FROM_ADDRESS = 1_500;

export type RateLimiter = {
  /** Seconds to wait, or null when the request may go ahead. */
  (key: string): number | null;
  /** Keys with a window still open, for tests. */
  readonly size: number;
};

/**
 * Fixed window per key: cheap protection against a leaked token hammering the database. Windows
 * that ended are dropped once a minute, so made-up keys can't grow the map without end.
 */
export function createRateLimiter(nowMs: () => number, maxRequests = MAX_REQUESTS): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();
  let sweptAt = nowMs();

  function sweep(now: number) {
    if (now - sweptAt < WINDOW_MS) return;
    sweptAt = now;
    for (const [key, window] of windows) {
      if (now - window.startedAt >= WINDOW_MS) windows.delete(key);
    }
  }

  const check = (key: string): number | null => {
    const now = nowMs();
    sweep(now);
    const current = windows.get(key);
    if (!current || now - current.startedAt >= WINDOW_MS) {
      windows.set(key, { startedAt: now, count: 1 });
      return null;
    }
    current.count += 1;
    if (current.count <= maxRequests) return null;
    return Math.ceil((current.startedAt + WINDOW_MS - now) / 1000);
  };
  return Object.defineProperty(check, 'size', { get: () => windows.size }) as RateLimiter;
}

/**
 * Failed sign-ins per address: each one after the first waits a little longer before its answer
 * (up to 3 s), which makes guessing a 43-character token slower still and shows in the log.
 */
export function createSignInGuard(nowMs: () => number) {
  const failures = new Map<string, { count: number; lastAt: number }>();
  return {
    /** How long to hold this failed answer, and the count so far. */
    failed(address: string): { delayMs: number; count: number } {
      const now = nowMs();
      const previous = failures.get(address);
      const count = previous && now - previous.lastAt < WINDOW_MS * 10 ? previous.count + 1 : 1;
      failures.set(address, { count, lastAt: now });
      if (failures.size > 10_000) failures.clear();
      return { delayMs: Math.min(3_000, count <= 1 ? 0 : 100 * 2 ** (count - 2)), count };
    },
    succeeded(address: string): void {
      failures.delete(address);
    },
  };
}
