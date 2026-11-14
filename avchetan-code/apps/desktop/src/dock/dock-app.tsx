import { createLogger } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { DockLockedNotice } from '../lock-screen';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';
import { useTableInvalidation } from '../use-app-event';
import { isHidden, useLockStatus } from '../use-lock';
import { AskPanel } from './ask-panel';
import { CaptureInput } from './capture-input';
import { DockFooter } from './dock-footer';
import { HotkeyBanner } from './hotkey-banner';
import { RecentCaptures } from './recent-captures';
import { useDraftPersistence } from './use-draft-persistence';
import { useVoice } from './use-voice';
import { useWindowContext } from './use-window-context';

const log = createLogger('dock');

/** The quick-capture HUD. Its webview stays alive while hidden; it is never reloaded. */
export function DockApp() {
  const { platform } = useServices();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autosave = useDraftPersistence();
  const asking = useDockStore((state) => state.ask !== null);
  const askStatus = useDockStore((state) => state.ask?.status ?? null);
  const setHighlight = useDockStore((state) => state.setHighlight);
  const voice = useVoice(inputRef);
  const recording = voice.phase === 'listening' || voice.phase === 'starting';
  const cancelVoice = voice.cancel;
  useTableInvalidation();
  const locked = isHidden(useLockStatus());
  const shell = useRef<HTMLDivElement>(null);
  const backdrop = useQuery({
    queryKey: ['dock-backdrop'],
    queryFn: () => platform.shell.dockBackdrop(),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  // Windows draws the panel (backdrop, rounded corners, shadow) when it can; else the page does.
  const drawn = backdrop === 'acrylic' || backdrop === 'mica';
  useFitWindow(shell, platform.shell.fitDock);

  /**
   * The text box gets the keyboard on the next frame: by then Rust has focused the webview
   * (windows.rs), so the first key typed after the shortcut lands in the box.
   */
  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);

  const hide = useCallback(() => {
    void autosave.flush();
    platform.shell.hideDock().catch(() => log.warn('could not hide dock'));
  }, [autosave, platform]);

  const panel = useRef<HTMLElement>(null);
  useWindowContext(() => {
    setHighlight(null);
    focusInput();
    playOpening(panel.current);
  });

  // Back to the box once voice, an answer or the unlock prompt is done.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus on each change
  useEffect(focusInput, [voice.phase, askStatus, locked, focusInput]);

  useEffect(() => {
    focusInput();
    const onKeyDown = (event: KeyboardEvent) => {
      // The box handled it (dock-keys.ts), or a button is being used with the keyboard.
      if (event.defaultPrevented || event.target === inputRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Esc while recording throws the recording away; the dock stays.
        if (recording) return cancelVoice();
        return hide();
      }
      // A key typed anywhere else in the dock goes to the box: focused during keydown, the
      // character lands there.
      const typing = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
      if (typing) inputRef.current?.focus({ preventScroll: true });
    };
    /** After a click in the list or a panel, the keyboard goes back to the box. */
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;
      // Text being selected (to copy an answer) stays selected.
      if (window.getSelection()?.toString()) return;
      focusInput();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onClick);
    window.addEventListener('focus', focusInput);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onClick);
      window.removeEventListener('focus', focusInput);
    };
  }, [hide, focusInput, recording, cancelVoice]);

  return (
    <div ref={shell} className={drawn ? '' : 'p-2'}>
      <main
        ref={panel}
        className={`flex flex-col gap-2 p-3 ${
          drawn
            ? 'bg-surface/75'
            : 'rounded-[var(--radius-panel)] border border-line bg-surface/90 shadow-xl backdrop-blur-xl'
        }`}
      >
        <HotkeyBanner />
        <CaptureInput
          inputRef={inputRef}
          onCaptured={() => void autosave.flush()}
          onHide={hide}
          voice={voice}
        />
        <div className="max-h-[360px] overflow-y-auto empty:hidden">
          {locked ? <DockLockedNotice /> : asking ? <AskPanel /> : <RecentCaptures />}
        </div>
        <DockFooter />
      </main>
    </div>
  );
}

/**
 * The window takes the height of what the dock shows: one bar when there is nothing under the
 * box, taller as the list grows (docs/product/capture-box-redesign.md#3-the-new-look).
 */
function useFitWindow(
  shell: RefObject<HTMLDivElement | null>,
  fit: (height: number) => Promise<unknown>,
) {
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      fit(height).catch(() => log.warn('could not fit the dock'));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shell, fit]);
}

/** A short fade and drop as the dock shows; none when Windows has animations turned off. */
function playOpening(element: HTMLElement | null) {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.animate(
    [
      { opacity: 0, transform: 'translateY(-6px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  );
}
