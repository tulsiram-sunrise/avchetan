/** With nothing to send, the background task pulls other devices' changes at most this often. */
export const BACKGROUND_PULL_EVERY_MS = 60 * 60_000;

export type BackgroundState = {
  /** Changes waiting in the outbox. */
  toSend: number;
  /** This device's entries that could be organized now. */
  toOrganize: number;
  /** When the last pull finished, or null if it never did. */
  lastPullAt: string | null;
  /** The wait after the hub couldn't be reached (see `unreachableBackoff`). */
  unreachable: UnreachableState | null;
  now: string;
};

export type BackgroundPlan = { sync: boolean; organize: boolean };

/**
 * What a background run does. Android wakes the app about every 15 minutes; a run with nothing
 * to do keeps it asleep instead (docs/product/finding-and-using-data.md §8).
 */
export function backgroundPlan({
  toSend,
  toOrganize,
  lastPullAt,
  unreachable,
  now,
}: BackgroundState): BackgroundPlan {
  const pullDue =
    lastPullAt === null || Date.parse(now) - Date.parse(lastPullAt) >= BACKGROUND_PULL_EVERY_MS;
  // A pull since the failure (the app was opened at home, say) ends the wait.
  const quiet =
    unreachable !== null &&
    Date.parse(now) < Date.parse(unreachable.until) &&
    !(lastPullAt !== null && lastPullAt > unreachable.since);
  return { sync: !quiet && (toSend > 0 || pullDue), organize: toOrganize > 0 };
}

/** The first wait after the hub couldn't be reached; it doubles each time, up to the most. */
export const UNREACHABLE_FIRST_WAIT_MS = 30 * 60_000;
export const UNREACHABLE_MOST_WAIT_MS = 4 * 60 * 60_000;

export type UnreachableState = { tries: number; since: string; until: string };

/**
 * After a background sync that couldn't reach the hub (away from home, say), the next runs leave
 * syncing alone for a while: each try waits seconds on every address, which kept the phone
 * awake about ten times longer than it worked (roadmap, v0.4.0 battery result). Opening the
 * app still syncs at once. Null once the hub answers; another kind of failure changes nothing.
 */
export function unreachableBackoff(
  previous: UnreachableState | null,
  outcome: 'reached' | 'unreachable' | 'other',
  now: string,
): UnreachableState | null {
  if (outcome === 'reached') return null;
  if (outcome === 'other') return previous;
  const tries = (previous?.tries ?? 0) + 1;
  const wait = Math.min(UNREACHABLE_FIRST_WAIT_MS * 2 ** (tries - 1), UNREACHABLE_MOST_WAIT_MS);
  return { tries, since: now, until: new Date(Date.parse(now) + wait).toISOString() };
}
