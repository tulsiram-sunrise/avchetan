import { openTestStore } from '@avchetan/db/testing';
import type { UnlockOutcome } from '@avchetan/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Lock } from '../native/lock';
import { applySavedAppLock, loadAppLock, saveAppLock, unlockApp, unlockMessage } from './app-lock';

function fakeLock(outcome: UnlockOutcome) {
  const status = { configured: true, enabled: true, locked: true };
  return {
    status: vi.fn(async () => status),
    configure: vi.fn(async () => status),
    available: vi.fn(async () => outcome !== 'unavailable'),
    lockNow: vi.fn(async () => status),
    unlock: vi.fn(async () => outcome),
  } satisfies Lock;
}

describe('app lock setting', () => {
  it('is off until turned on, and is handed to Rust at start', async () => {
    const { store } = await openTestStore();
    const lock = fakeLock('verified');
    expect((await loadAppLock(store)).enabled).toBe(false);
    await saveAppLock(store, { enabled: true, after: '30m', hidePreview: true });
    await applySavedAppLock(store, lock);
    expect(lock.configure).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, after: '30m' }),
    );
  });
});

describe('unlockApp', () => {
  it('keeps the lock on when Hello is cancelled', async () => {
    const { store } = await openTestStore();
    await saveAppLock(store, { enabled: true, after: '1m', hidePreview: true });
    const lock = fakeLock('cancelled');
    expect(await unlockApp(store, lock, 'Unlock Avchetan')).toBe('cancelled');
    expect((await loadAppLock(store)).enabled).toBe(true);
    expect(lock.configure).not.toHaveBeenCalled();
    expect(unlockMessage('cancelled')).toBeNull();
  });

  it('turns the lock off when Windows Hello was removed', async () => {
    const { store } = await openTestStore();
    await saveAppLock(store, { enabled: true, after: '1m', hidePreview: true });
    const lock = fakeLock('unavailable');
    expect(await unlockApp(store, lock, 'Unlock Avchetan')).toBe('unavailable');
    expect((await loadAppLock(store)).enabled).toBe(false);
    expect(lock.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(unlockMessage('unavailable')).toMatch(/now off/);
  });
});
