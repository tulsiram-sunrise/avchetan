/** With nothing to send, the background task pulls other devices' changes at most this often. */
export const BACKGROUND_PULL_EVERY_MS = 60 * 60_000;

export type BackgroundState = {
  /** Changes waiting in the outbox. */
  toSend: number;
  /** This device's entries that could be organized now. */
  toOrganize: number;
  /** When the last pull finished, or null if it never did. */
  lastPullAt: string | null;
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
  now,
}: BackgroundState): BackgroundPlan {
  const pullDue =
    lastPullAt === null || Date.parse(now) - Date.parse(lastPullAt) >= BACKGROUND_PULL_EVERY_MS;
  return { sync: toSend > 0 || pullDue, organize: toOrganize > 0 };
}
