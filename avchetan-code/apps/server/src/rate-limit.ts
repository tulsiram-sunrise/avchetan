const WINDOW_MS = 60_000;

/** Requests a device may make in a minute: everything but pulls. */
export const MAX_REQUESTS = 60;
/**
 * Pulls have their own, larger budget: a phone's first download of a long history needs hundreds
 * of pages in a row (50,000 entries are about 150,000 rows), and pulling only reads what the
 * token already opens. At 60 the download was refused after a minute and never finished.
 */
export const MAX_PULLS = 600;

/** Fixed window per device: cheap protection against a leaked token hammering the database. */
export function createRateLimiter(nowMs: () => number, maxRequests = MAX_REQUESTS) {
  const windows = new Map<string, { startedAt: number; count: number }>();

  /** Seconds to wait, or null when the request may go ahead. */
  return function check(key: string): number | null {
    const now = nowMs();
    const current = windows.get(key);
    if (!current || now - current.startedAt >= WINDOW_MS) {
      windows.set(key, { startedAt: now, count: 1 });
      return null;
    }
    current.count += 1;
    if (current.count <= maxRequests) return null;
    return Math.ceil((current.startedAt + WINDOW_MS - now) / 1000);
  };
}
