import { z } from 'zod';

/**
 * App lock settings and timing, shared by both apps (docs/product/app-lock.md). Each device keeps
 * its own copy in the client-local `settings` table; nothing here is synced.
 */

export const LOCK_AFTER = ['immediately', '1m', '30m'] as const;
export type LockAfter = (typeof LOCK_AFTER)[number];

export const APP_LOCK_SETTING = 'lock.app';

export const appLockSettingsSchema = z.object({
  enabled: z.boolean(),
  after: z.enum(LOCK_AFTER),
  /** Phone only: blank recent-apps preview, which also blocks screenshots (FLAG_SECURE). */
  hidePreview: z.boolean(),
});
export type AppLockSettings = z.infer<typeof appLockSettingsSchema>;

export const DEFAULT_APP_LOCK: AppLockSettings = {
  enabled: false,
  after: '1m',
  hidePreview: true,
};

/**
 * A missing setting is the default: off. Each field is read on its own, so one unreadable field
 * never turns a lock that is on off.
 */
export function parseAppLockSettings(value: unknown): AppLockSettings {
  const saved =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const field = <K extends keyof AppLockSettings>(key: K): AppLockSettings[K] => {
    const parsed = appLockSettingsSchema.shape[key].safeParse(saved[key]);
    return (parsed.success ? parsed.data : DEFAULT_APP_LOCK[key]) as AppLockSettings[K];
  };
  return { enabled: field('enabled'), after: field('after'), hidePreview: field('hidePreview') };
}

export function lockAfterMs(after: LockAfter): number {
  switch (after) {
    case 'immediately':
      return 0;
    case '1m':
      return 60_000;
    case '30m':
      return 30 * 60_000;
  }
}

export const LOCK_AFTER_LABELS: Record<LockAfter, string> = {
  immediately: 'Immediately',
  '1m': 'After 1 minute',
  '30m': 'After 30 minutes',
};

/**
 * Whether the app should be locked when the user comes back. `awaySinceMs` and `nowMs` are
 * milliseconds from one source (never persisted); `null` means the user never left. A clock that
 * went backwards locks: setting the phone's time back must not skip the lock.
 */
export function shouldLock(input: {
  enabled: boolean;
  after: LockAfter;
  awaySinceMs: number | null;
  nowMs: number;
}): boolean {
  if (!input.enabled || input.awaySinceMs === null) return false;
  const away = input.nowMs - input.awaySinceMs;
  return away < 0 || away >= lockAfterMs(input.after);
}

/** What the device's own unlock prompt reported. Only `verified` unlocks. */
export const UNLOCK_OUTCOMES = ['verified', 'cancelled', 'unavailable', 'failed'] as const;
export type UnlockOutcome = (typeof UNLOCK_OUTCOMES)[number];
export const unlockOutcomeSchema = z.enum(UNLOCK_OUTCOMES);
