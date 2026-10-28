import { createLogger } from '@avchetan/shared';
import { useEffect, useRef } from 'react';
import { useServices } from '../services-context';
import { useAppEvent, useTableInvalidation } from '../use-app-event';
import { CaptureInput } from './capture-input';
import { DockFooter } from './dock-footer';
import { HotkeyBanner } from './hotkey-banner';
import { RecentCaptures } from './recent-captures';
import { useDraftPersistence } from './use-draft-persistence';

const log = createLogger('dock');

/** The quick-capture HUD. Its webview stays alive while hidden; it is never reloaded. */
export function DockApp() {
  const { platform } = useServices();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autosave = useDraftPersistence();
  useTableInvalidation();

  useAppEvent('dock:shown', () => inputRef.current?.focus());

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    focusInput();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void autosave.flush();
      platform.shell.hideDock().catch(() => log.warn('could not hide dock'));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focus', focusInput);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focus', focusInput);
    };
  }, [autosave, platform]);

  return (
    <div className="h-screen p-2">
      <main className="flex h-full flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface/90 p-3 shadow-xl backdrop-blur-xl">
        <HotkeyBanner />
        <CaptureInput inputRef={inputRef} onCaptured={() => void autosave.flush()} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RecentCaptures />
        </div>
        <DockFooter />
      </main>
    </div>
  );
}
