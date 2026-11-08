import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_LOCK, lockAfterMs, parseAppLockSettings, shouldLock } from './app-lock';

describe('shouldLock', () => {
  const base = { enabled: true, after: '1m' as const, awaySinceMs: 1_000, nowMs: 1_000 };

  it('never locks when the lock is off', () => {
    expect(shouldLock({ ...base, enabled: false, nowMs: 10_000_000 })).toBe(false);
  });

  it('never locks when the user never left', () => {
    expect(shouldLock({ ...base, awaySinceMs: null, nowMs: 10_000_000 })).toBe(false);
  });

  it('locks once the chosen time away has passed', () => {
    expect(shouldLock({ ...base, nowMs: 1_000 + 59_999 })).toBe(false);
    expect(shouldLock({ ...base, nowMs: 1_000 + 60_000 })).toBe(true);
  });

  it('locks when the clock went backwards', () => {
    expect(shouldLock({ ...base, nowMs: 500 })).toBe(true);
  });

  it('locks at once with Immediately', () => {
    expect(shouldLock({ ...base, after: 'immediately' })).toBe(true);
  });

  it('waits 30 minutes with After 30 minutes', () => {
    expect(shouldLock({ ...base, after: '30m', nowMs: 1_000 + 29 * 60_000 })).toBe(false);
    expect(shouldLock({ ...base, after: '30m', nowMs: 1_000 + 30 * 60_000 })).toBe(true);
  });
});

describe('parseAppLockSettings', () => {
  it('is off with nothing saved', () => {
    expect(parseAppLockSettings(undefined)).toEqual(DEFAULT_APP_LOCK);
    expect(parseAppLockSettings('garbage')).toEqual(DEFAULT_APP_LOCK);
  });

  it('fills fields an older app version did not save', () => {
    expect(parseAppLockSettings({ enabled: true })).toEqual({ ...DEFAULT_APP_LOCK, enabled: true });
  });

  it('drops an unknown time but keeps the lock on', () => {
    expect(parseAppLockSettings({ enabled: true, after: '5m' })).toEqual({
      ...DEFAULT_APP_LOCK,
      enabled: true,
    });
  });
});

describe('lockAfterMs', () => {
  it('maps every choice', () => {
    expect([lockAfterMs('immediately'), lockAfterMs('1m'), lockAfterMs('30m')]).toEqual([
      0, 60_000, 1_800_000,
    ]);
  });
});
