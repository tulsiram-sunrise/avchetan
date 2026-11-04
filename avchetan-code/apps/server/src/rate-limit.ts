const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

/** Fixed window per device: cheap protection against a leaked token hammering the database. */
export function createRateLimiter(nowMs: () => number) {
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
    if (current.count <= MAX_REQUESTS) return null;
    return Math.ceil((current.startedAt + WINDOW_MS - now) / 1000);
  };
}
