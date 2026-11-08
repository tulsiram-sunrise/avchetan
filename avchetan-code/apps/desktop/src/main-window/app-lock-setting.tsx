import {
  APP_LOCK_SETTING,
  type AppLockSettings,
  LOCK_AFTER,
  LOCK_AFTER_LABELS,
  type LockAfter,
} from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HelpLink } from '../help-link';
import { loadAppLock, saveAppLock, unlockApp, unlockMessage } from '../services/app-lock';
import { useServices } from '../services-context';
import { ActionError } from './ui';

const settingQuery = ['settings', APP_LOCK_SETTING] as const;

export function useAppLockSetting() {
  const { store } = useServices();
  return useQuery({ queryKey: settingQuery, queryFn: () => loadAppLock(store) });
}

export function useHelloAvailable() {
  const { platform } = useServices();
  return useQuery({
    queryKey: ['native', 'hello'],
    queryFn: () => platform.lock.available(),
  });
}

/**
 * Saves the setting and hands it to Rust. Turning the lock on or off asks Windows Hello first, so
 * you know it works and nobody else can switch it off.
 */
export function useChangeAppLock() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: async (next: AppLockSettings) => {
      setMessage(null);
      const current = await loadAppLock(store);
      if (next.enabled !== current.enabled) {
        const reason = next.enabled ? 'Turn on the app lock' : 'Turn off the app lock';
        const outcome = await unlockApp(store, platform.lock, reason);
        if (outcome !== 'verified') {
          setMessage(unlockMessage(outcome));
          return false;
        }
      }
      await saveAppLock(store, next);
      await platform.lock.configure(next);
      return true;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingQuery });
      void queryClient.invalidateQueries({ queryKey: ['native', 'lock'] });
      void queryClient.invalidateQueries({ queryKey: ['native', 'hello'] });
    },
  });
  return { change, message };
}

/** Settings → Privacy → App lock (docs/product/app-lock.md). */
export function AppLockSetting() {
  const setting = useAppLockSetting();
  const available = useHelloAvailable();
  const { change, message } = useChangeAppLock();
  const current = setting.data;
  const canTurnOn = available.data === true;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">App lock</h2>
      <p className="text-sm text-ink-muted">
        Lock Avchetan with Windows Hello (your PIN, fingerprint or face), so someone using your PC
        can’t read your entries. You can still write things down with the capture box while it’s
        locked; it shows nothing you wrote before.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={current?.enabled ?? false}
          disabled={!current || change.isPending || (!current.enabled && !canTurnOn)}
          onChange={(event) => {
            if (current) change.mutate({ ...current, enabled: event.target.checked });
          }}
        />
        Lock Avchetan with Windows Hello
      </label>
      {available.data === false && !current?.enabled ? (
        <p className="text-sm text-ink-muted">
          Windows Hello isn’t set up on this PC. Set up a PIN in Windows Settings → Accounts →
          Sign-in options, then come back. <HelpLink code="app_lock_unavailable" />
        </p>
      ) : null}
      {current?.enabled ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-sm">Lock again when the window was away</legend>
          {LOCK_AFTER.map((after: LockAfter) => (
            <label key={after} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="lock-after"
                value={after}
                checked={current.after === after}
                disabled={change.isPending}
                onChange={() => change.mutate({ ...current, after })}
              />
              {LOCK_AFTER_LABELS[after]}
            </label>
          ))}
          <p className="pt-1 text-xs text-ink-muted">
            Away means the main window is closed or minimized. Avchetan also locks at once when
            Windows locks or the PC sleeps.
          </p>
        </fieldset>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-danger">
          {message} <HelpLink code="app_lock_unavailable" />
        </p>
      ) : null}
      <ActionError errors={[change.error, setting.error]} />
    </section>
  );
}
