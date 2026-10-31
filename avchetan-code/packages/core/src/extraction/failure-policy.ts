import type { AppError } from '@avchetan/shared';

export const MAX_ATTEMPTS = 3;

const ATTEMPT_BACKOFF_MS = [30_000, 120_000, 600_000] as const;
const RATE_LIMIT_WAIT_MS = 60_000;
const NETWORK_WAIT_MS = 60_000;
const NEEDS_USER_WAIT_MS = 600_000;

export type FailureDecision =
  /** Says nothing about this log: hold the whole queue, and don't count an attempt. */
  | { kind: 'wait'; delayMs: number }
  /** May be this log's fault: count it, and give up after `MAX_ATTEMPTS`. */
  | { kind: 'attempt' }
  /** Retrying can't help: mark the log as an error now. */
  | { kind: 'give_up' };

/**
 * What a failed extraction means for the queue. A rate limit is the normal state of a free
 * tier, so it must never use up attempts, or a burst of entries would end up as errors. A
 * bad key or a missing model fails the same way for every log, so the rest wait for the user.
 */
export function decideFailure(error: AppError): FailureDecision {
  const details = error.details ?? {};
  switch (error.code) {
    case 'llm_auth':
      return { kind: 'wait', delayMs: NEEDS_USER_WAIT_MS };
    case 'llm_rate_limit':
      return {
        kind: 'wait',
        delayMs:
          typeof details.retryAfterMs === 'number' ? details.retryAfterMs : RATE_LIMIT_WAIT_MS,
      };
    case 'llm_unavailable':
      if (details.reason === 'model_missing') return { kind: 'wait', delayMs: NEEDS_USER_WAIT_MS };
      // No HTTP status and no timeout: the request never got an answer, so we're offline.
      if (details.status === undefined && details.reason === undefined) {
        return { kind: 'wait', delayMs: NETWORK_WAIT_MS };
      }
      return { kind: 'attempt' };
    case 'llm_refused':
      return { kind: 'give_up' };
    default:
      return { kind: 'attempt' };
  }
}

/** Delay before the next attempt, or null once attempts run out. `attempts` includes this one. */
export function attemptBackoffMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return ATTEMPT_BACKOFF_MS[attempts - 1] ?? null;
}
