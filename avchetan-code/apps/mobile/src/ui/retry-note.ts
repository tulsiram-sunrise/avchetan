import type { RawLog } from '@avchetan/db/sqlite';
import { formatTime } from '@avchetan/shared';

/**
 * A failed try on an entry that will be tried again is no failure yet: a slow first try on the
 * hub's PC is normal (the model loading). Only `error` is a failure worth red.
 */
export function willRetry(rawLog: Pick<RawLog, 'status' | 'lastError'>): boolean {
  return rawLog.status === 'pending_llm' && rawLog.lastError !== null;
}

/** "Taking longer than usual, trying again at 7:12" (or "soon" once that time has passed). */
export function retryNote(
  rawLog: Pick<RawLog, 'nextAttemptAt'>,
  nowMs: number = Date.now(),
): string {
  const at = rawLog.nextAttemptAt;
  const when = at && Date.parse(at) > nowMs ? `at ${formatTime(at)}` : 'soon';
  return `Taking longer than usual, trying again ${when}`;
}
