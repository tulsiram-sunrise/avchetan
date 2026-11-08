import { type AppLockSettings, unlockOutcomeSchema } from '@avchetan/shared';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

/** What src-tauri/src/app_lock.rs reports, and sends with `lock:changed`. */
export const lockStatusSchema = z.object({
  /** False until the dock passed the setting in at start. */
  configured: z.boolean(),
  enabled: z.boolean(),
  locked: z.boolean(),
});
export type LockStatus = z.infer<typeof lockStatusSchema>;

/** App lock commands (docs/product/app-lock.md). The lock state lives in Rust only. */
export function createLock(invoke: Invoke) {
  return {
    status: () => callNative(invoke, 'lock_status', {}, lockStatusSchema),
    configure: (settings: Pick<AppLockSettings, 'enabled' | 'after'>) =>
      callNative(
        invoke,
        'lock_configure',
        { enabled: settings.enabled, after: settings.after },
        lockStatusSchema,
      ),
    /** Whether Windows Hello is set up for this user. */
    available: () =>
      callNative(invoke, 'lock_available', {}, z.enum(['available', 'unavailable'])).then(
        (answer) => answer === 'available',
      ),
    /** Locks at once (`/lock`); does nothing while the lock is off. */
    lockNow: () => callNative(invoke, 'lock_now', {}, lockStatusSchema),
    /** Shows Windows Hello over the calling window; `reason` is the line it shows. */
    unlock: (reason: string) => callNative(invoke, 'lock_unlock', { reason }, unlockOutcomeSchema),
  };
}

export type Lock = ReturnType<typeof createLock>;
