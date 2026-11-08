import type { AppLockSettings, UnlockOutcome } from '@avchetan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { expoDeviceLock } from '../platform/device-lock';
import { changeAppLock, unlockApp, useAppLock } from '../services/app-lock';
import { useServices } from '../services-context';

/** Turning the lock on or off asks the phone's own lock first (app-lock.md). */
export function useChangeAppLock() {
  const { store } = useServices();
  return useMutation({
    mutationFn: async (next: AppLockSettings): Promise<UnlockOutcome> => {
      const current = useAppLock.getState().settings;
      if (next.enabled !== current.enabled) {
        const reason = next.enabled ? 'Turn on the app lock' : 'Turn off the app lock';
        const outcome = await unlockApp(store, expoDeviceLock, reason);
        if (outcome !== 'verified') return outcome;
      }
      await changeAppLock(store, expoDeviceLock, next);
      return 'verified';
    },
  });
}

export function useDeviceLockAvailable() {
  return useQuery({ queryKey: ['device', 'lock'], queryFn: () => expoDeviceLock.available() });
}
