import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import {
  APP_LOCK_SETTING,
  type AppLockSettings,
  createLogger,
  DEFAULT_APP_LOCK,
  parseAppLockSettings,
  shouldLock,
  type UnlockOutcome,
} from '@avchetan/shared';
import { create } from 'zustand';

const log = createLogger('app-lock');

/**
 * The phone's own lock (expo-local-authentication) and the recent-apps cover (expo-screen-capture),
 * injected so the logic below can be tested without a device.
 */
export type DeviceLock = {
  /** The phone has a screen lock or biometrics to unlock with. */
  available(): Promise<boolean>;
  authenticate(reason: string): Promise<UnlockOutcome>;
  /** `FLAG_SECURE`: blank recent-apps preview, and no screenshots of Avchetan. */
  hidePreview(hide: boolean): Promise<void>;
};

export async function loadAppLock(store: ClientStore): Promise<AppLockSettings> {
  return parseAppLockSettings(await getSetting(store.db, APP_LOCK_SETTING));
}

export async function saveAppLock(store: ClientStore, settings: AppLockSettings): Promise<void> {
  await store.write((tx) => setSetting(tx, APP_LOCK_SETTING, settings, store.clock.now()));
}

type LockState = {
  settings: AppLockSettings;
  locked: boolean;
  /** The phone's own prompt is up; leaving and coming back for it is not being away. */
  prompting: boolean;
  /** When the app went to the background (ms, memory only). */
  awaySinceMs: number | null;
};

/** One lock for the whole app (docs/product/app-lock.md). Starts locked until the setting is read. */
export const useAppLock = create<LockState>(() => ({
  settings: { ...DEFAULT_APP_LOCK, enabled: true },
  locked: true,
  prompting: false,
  awaySinceMs: null,
}));

/** At start: locked when the lock is on. */
export async function startAppLock(store: ClientStore, device: DeviceLock): Promise<void> {
  const settings = await loadAppLock(store);
  useAppLock.setState({ settings, locked: settings.enabled, awaySinceMs: null });
  await device.hidePreview(settings.enabled && settings.hidePreview);
  log.info('app lock started', { enabled: settings.enabled, after: settings.after });
}

/** The app went to the background. */
export function appLeft(nowMs: number): void {
  const { settings, locked, prompting, awaySinceMs } = useAppLock.getState();
  if (!settings.enabled || locked || prompting || awaySinceMs !== null) return;
  if (settings.after === 'immediately') useAppLock.setState({ locked: true });
  else useAppLock.setState({ awaySinceMs: nowMs });
}

/** The app is back in front. */
export function appReturned(nowMs: number): void {
  const { settings, prompting, awaySinceMs } = useAppLock.getState();
  if (prompting) return;
  const lock = shouldLock({ enabled: settings.enabled, after: settings.after, awaySinceMs, nowMs });
  useAppLock.setState((state) => ({ awaySinceMs: null, locked: state.locked || lock }));
}

/**
 * Shows the phone's own prompt. Only `verified` unlocks. When the phone has no lock any more, the
 * owner removed it (that needs the old one), so the app lock turns itself off.
 */
export async function unlockApp(
  store: ClientStore,
  device: DeviceLock,
  reason: string,
): Promise<UnlockOutcome> {
  if (useAppLock.getState().prompting) return 'failed';
  useAppLock.setState({ prompting: true });
  let outcome: UnlockOutcome;
  try {
    outcome = (await device.available()) ? await device.authenticate(reason) : 'unavailable';
  } finally {
    useAppLock.setState({ prompting: false });
  }
  log.info('unlock', { outcome });
  if (outcome === 'verified') {
    useAppLock.setState({ locked: false, awaySinceMs: null });
  } else if (outcome === 'unavailable') {
    const settings = useAppLock.getState().settings;
    if (settings.enabled) {
      await changeAppLock(store, device, { ...settings, enabled: false });
      useAppLock.setState({ locked: false });
      log.info('app lock turned off: no screen lock');
    }
  }
  return outcome;
}

/** Saves the setting and applies it; the caller has already confirmed with the phone's lock. */
export async function changeAppLock(
  store: ClientStore,
  device: DeviceLock,
  settings: AppLockSettings,
): Promise<void> {
  await saveAppLock(store, settings);
  useAppLock.setState((state) => ({
    settings,
    locked: settings.enabled ? state.locked : false,
    awaySinceMs: null,
  }));
  await device.hidePreview(settings.enabled && settings.hidePreview);
}

/**
 * Screens that stay open while locked: capture, which writes only. Setup runs on a first start,
 * before there is any lock, and could change how this phone syncs, so it is locked too.
 */
export function isOpenWhileLocked(routeName: string): boolean {
  return routeName === 'capture';
}

export function unlockMessage(outcome: UnlockOutcome | null): string | null {
  switch (outcome) {
    case 'failed':
      return 'Unlocking didn’t work this time. Try again.';
    case 'unavailable':
      return 'This phone has no screen lock any more, so the app lock is now off.';
    default:
      return null;
  }
}
