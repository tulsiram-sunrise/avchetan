import { openTestStore } from '@avchetan/db/testing';
import type { UnlockOutcome } from '@avchetan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appLeft,
  appReturned,
  changeAppLock,
  type DeviceLock,
  isOpenWhileLocked,
  loadAppLock,
  saveAppLock,
  startAppLock,
  unlockApp,
  useAppLock,
} from './app-lock';

function fakeDevice(outcome: UnlockOutcome = 'verified') {
  return {
    available: vi.fn(async () => outcome !== 'unavailable'),
    authenticate: vi.fn(async () => outcome),
    hidePreview: vi.fn(async () => undefined),
  } satisfies DeviceLock;
}

async function startedWith(after: '1m' | 'immediately' = '1m', enabled = true) {
  const { store } = await openTestStore();
  await saveAppLock(store, { enabled, after, hidePreview: true });
  const device = fakeDevice();
  await startAppLock(store, device);
  return { store, device };
}

beforeEach(() => {
  useAppLock.setState({ locked: true, prompting: false, awaySinceMs: null });
});

describe('startAppLock', () => {
  it('opens unlocked when the lock is off', async () => {
    const { device } = await startedWith('1m', false);
    expect(useAppLock.getState().locked).toBe(false);
    expect(device.hidePreview).toHaveBeenCalledWith(false);
  });

  it('starts locked, with the recent-apps cover, when the lock is on', async () => {
    const { device } = await startedWith();
    expect(useAppLock.getState().locked).toBe(true);
    expect(device.hidePreview).toHaveBeenCalledWith(true);
  });
});

describe('leaving and coming back', () => {
  it('locks after the chosen time away, not before', async () => {
    const { store, device } = await startedWith('1m');
    await unlockApp(store, device, 'Unlock');
    appLeft(1_000);
    appReturned(1_000 + 59_000);
    expect(useAppLock.getState().locked).toBe(false);
    appLeft(100_000);
    appReturned(100_000 + 60_000);
    expect(useAppLock.getState().locked).toBe(true);
  });

  it('locks on leaving with Immediately', async () => {
    const { store, device } = await startedWith('immediately');
    await unlockApp(store, device, 'Unlock');
    appLeft(1_000);
    expect(useAppLock.getState().locked).toBe(true);
  });

  it('does not count the phone’s own prompt as being away', async () => {
    const { store } = await startedWith('immediately');
    const device = fakeDevice();
    device.authenticate.mockImplementation(async () => {
      // Android's PIN screen sends the app to the background and back.
      appLeft(1_000);
      appReturned(5_000);
      return 'verified';
    });
    expect(await unlockApp(store, device, 'Unlock')).toBe('verified');
    expect(useAppLock.getState().locked).toBe(false);
  });
});

describe('unlockApp', () => {
  it('stays locked when cancelled', async () => {
    const { store } = await startedWith();
    expect(await unlockApp(store, fakeDevice('cancelled'), 'Unlock')).toBe('cancelled');
    expect(useAppLock.getState().locked).toBe(true);
  });

  it('turns the lock off when the phone has no screen lock any more', async () => {
    const { store } = await startedWith();
    const device = fakeDevice('unavailable');
    expect(await unlockApp(store, device, 'Unlock')).toBe('unavailable');
    expect(useAppLock.getState().locked).toBe(false);
    expect((await loadAppLock(store)).enabled).toBe(false);
    expect(device.hidePreview).toHaveBeenCalledWith(false);
  });
});

describe('changeAppLock', () => {
  it('saves the setting and lifts the cover when screenshots are allowed again', async () => {
    const { store, device } = await startedWith();
    await changeAppLock(store, device, { enabled: true, after: '30m', hidePreview: false });
    expect(await loadAppLock(store)).toEqual({ enabled: true, after: '30m', hidePreview: false });
    expect(device.hidePreview).toHaveBeenLastCalledWith(false);
  });
});

describe('isOpenWhileLocked', () => {
  it('leaves only capture open', () => {
    expect(isOpenWhileLocked('capture')).toBe(true);
    for (const route of ['(tabs)', 'setup', 'log/[id]', 'people/index', 'settings/app-lock']) {
      expect(isOpenWhileLocked(route)).toBe(false);
    }
  });
});
