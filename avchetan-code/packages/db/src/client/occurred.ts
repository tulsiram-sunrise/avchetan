import { localDate } from '@avchetan/shared';

type Saved = { capturedAt: string; capturedTz: string };

/**
 * When an activity happened, as far as Avchetan knows: its own time, else the time its entry was
 * saved when that was the same local day ("Going to sleep" typed at 00:32 happened at 00:32).
 * An entry about another day ("ran yesterday") has no time.
 */
export function occurredAtOf(
  activity: { loggedDate: string; occurredAt: string | null },
  log: Saved,
): string | null {
  if (activity.occurredAt) return activity.occurredAt;
  return localDate(log.capturedAt, log.capturedTz) === activity.loggedDate ? log.capturedAt : null;
}
