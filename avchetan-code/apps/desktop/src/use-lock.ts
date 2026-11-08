import type { UnlockOutcome } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LockStatus } from './native/lock';
import { unlockApp } from './services/app-lock';
import { useServices } from './services-context';
import { useAppEvent } from './use-app-event';

const lockQuery = ['native', 'lock'] as const;

/** Until Rust answers, treat the app as locked: nothing is shown before the lock is known. */
const UNKNOWN: LockStatus = { configured: false, enabled: false, locked: true };

/** The app lock as Rust holds it, kept current by `lock:changed` (docs/product/app-lock.md). */
export function useLockStatus(): LockStatus {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: lockQuery, queryFn: () => platform.lock.status() });
  useAppEvent('lock:changed', (next) => queryClient.setQueryData(lockQuery, next));
  return status.data ?? UNKNOWN;
}

/** True while nothing written before may be shown: locked, or not yet known. */
export function isHidden(status: LockStatus): boolean {
  return !status.configured || status.locked;
}

export function useUnlock() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string): Promise<UnlockOutcome> => unlockApp(store, platform.lock, reason),
    onSettled: () => queryClient.invalidateQueries({ queryKey: lockQuery }),
  });
}
