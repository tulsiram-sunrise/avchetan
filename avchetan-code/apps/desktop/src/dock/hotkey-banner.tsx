import { createLogger } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { HelpLink } from '../help-link';
import { saveSettingsTab } from '../main-window/settings-tabs';
import { emitAppEvent } from '../native/events';
import { useServices } from '../services-context';

const log = createLogger('dock');

/** Shown when the global shortcut couldn't be registered (another app owns it). */
export function HotkeyBanner() {
  const { platform } = useServices();
  const status = useQuery({
    queryKey: ['native', 'hotkey'],
    queryFn: () => platform.shell.hotkeyStatus(),
  });

  if (!status.data || status.data.registered) return null;
  return (
    <p role="alert" className="rounded-lg bg-warn/15 px-3 py-2 text-xs">
      The shortcut {status.data.shortcut} is used by another app, so it can't open Avchetan. Choose
      another in{' '}
      <button
        type="button"
        className="underline"
        onClick={() => {
          // The shortcut is under Capture box. Saved first: the main window may not be open yet.
          saveSettingsTab('capture');
          void platform.shell
            .openMain('settings')
            .then(() => emitAppEvent('main:navigate', { view: 'settings', tab: 'capture' }))
            .catch(() => log.warn('could not open settings'));
        }}
      >
        Settings → Capture box
      </button>
      . <HelpLink code="hotkey_unavailable" />
    </p>
  );
}
