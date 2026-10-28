import { useQuery } from '@tanstack/react-query';
import { HelpLink } from '../help-link';
import { useServices } from '../services-context';

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
        onClick={() => void platform.shell.openMain('settings')}
      >
        Settings
      </button>
      . <HelpLink code="hotkey_unavailable" />
    </p>
  );
}
