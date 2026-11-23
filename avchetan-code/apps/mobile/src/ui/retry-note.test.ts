import { formatTime } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { retryNote, willRetry } from './retry-note';

const NOW_MS = Date.parse('2026-10-26T10:00:00.000Z');

describe('willRetry', () => {
  it('is a failed try on an entry still waiting, not a failure', () => {
    expect(willRetry({ status: 'pending_llm', lastError: 'llm_unavailable: timeout' })).toBe(true);
    expect(willRetry({ status: 'error', lastError: 'llm_unavailable: timeout' })).toBe(false);
    expect(willRetry({ status: 'pending_llm', lastError: null })).toBe(false);
  });
});

describe('retryNote', () => {
  it('says when the next try is, while that is still ahead', () => {
    const at = '2026-10-26T10:02:00.000Z';
    expect(retryNote({ nextAttemptAt: at }, NOW_MS)).toBe(
      `Taking longer than usual, trying again at ${formatTime(at)}`,
    );
  });

  it('says soon once that time has passed or is unknown', () => {
    expect(retryNote({ nextAttemptAt: '2026-10-26T09:58:00.000Z' }, NOW_MS)).toBe(
      'Taking longer than usual, trying again soon',
    );
    expect(retryNote({ nextAttemptAt: null }, NOW_MS)).toMatch(/soon$/);
  });
});
