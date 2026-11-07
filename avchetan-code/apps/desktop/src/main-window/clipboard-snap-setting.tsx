import { loadContextSettings } from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { GUIDE_URL, openExternal } from '../help';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import type { HotkeyStatus } from '../native/shell';
import {
  changeSnapHotkey,
  DEFAULT_SNAP_HOTKEY,
  savedSnapHotkey,
  setSnapEnabled,
} from '../services/hotkey';
import { useServices } from '../services-context';

const log = createLogger('settings');

const settingsKey = ['settings', 'context'] as const;
const shortcutKey = ['settings', 'snap-hotkey'] as const;
const statusKey = ['native', 'snap-hotkey'] as const;

/** Settings → Capture box → Clipboard snap (docs/product/clipboard-snap.md). */
export function ClipboardSnapSetting() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => loadContextSettings(store) });
  const saved = useQuery({ queryKey: shortcutKey, queryFn: () => savedSnapHotkey(store) });
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => platform.shell.snapHotkeyStatus(),
  });
  const [value, setValue] = useState<string | null>(null);

  const afterChange = (next: HotkeyStatus) => {
    queryClient.setQueryData(statusKey, next);
    void queryClient.invalidateQueries({ queryKey: settingsKey });
    void queryClient.invalidateQueries({ queryKey: shortcutKey });
    // The dock reads the switch for the next snap.
    emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
      log.warn('could not announce a clipboard snap change'),
    );
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setSnapEnabled(store, platform.shell, enabled),
    onSuccess: afterChange,
  });
  const change = useMutation({
    mutationFn: (shortcut: string) => changeSnapHotkey(store, platform.shell, shortcut),
    onSuccess: (next) => {
      afterChange(next);
      if (next.registered) setValue(null);
    },
  });

  const enabled = settings.data?.snapEnabled ?? true;
  const current = saved.data ?? DEFAULT_SNAP_HOTKEY;
  const result = change.data ?? toggle.data ?? status.data;
  const failedCode =
    enabled && result && !result.registered && result.error
      ? result.error
      : change.error || toggle.error
        ? toAppError(change.error ?? toggle.error).code
        : null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Clipboard snap</h2>
      <p className="text-sm text-ink-muted">
        A second shortcut opens the capture box with the text you copied attached to the entry (up
        to 4 KB). The clipboard is read only when you press it.{' '}
        <button
          type="button"
          className="underline"
          onClick={() =>
            void openExternal(`${GUIDE_URL}/capture-on-windows#attach-the-clipboard`).catch(() =>
              log.warn('could not open a link'),
            )
          }
        >
          How it works
        </button>
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!settings.isSuccess || toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
        />
        Attach the clipboard with a second shortcut
      </label>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value?.trim()) change.mutate(value.trim());
        }}
      >
        <input
          aria-label="Clipboard shortcut"
          className="w-56 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm disabled:opacity-50"
          value={value ?? current}
          disabled={!enabled}
          onChange={(event) => setValue(event.target.value)}
          placeholder={DEFAULT_SNAP_HOTKEY}
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={!enabled || change.isPending || value === null || value.trim() === current}
        >
          Save
        </button>
      </form>
      {failedCode ? (
        <p role="alert" className="text-sm text-danger">
          {failedCode === 'hotkey_invalid'
            ? "That isn't a shortcut Avchetan can use, or it's the capture box's own. Try another."
            : "That shortcut can't be used (another app may own it). Try another."}{' '}
          <HelpLink code={failedCode} />
        </p>
      ) : null}
    </section>
  );
}
