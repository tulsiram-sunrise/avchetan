import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { HelpLink } from './help-link';
import { unlockMessage } from './services/app-lock';
import { useServices } from './services-context';
import { useUnlock } from './use-lock';

/** The line under the Unlock button after a failed or impossible unlock. */
function UnlockFeedback({ outcome }: { outcome: ReturnType<typeof useUnlock>['data'] }) {
  const message = unlockMessage(outcome ?? null);
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message} <HelpLink code="app_lock_unavailable" />
    </p>
  );
}

/** The whole main window while the app is locked (docs/product/app-lock.md). */
export function LockScreen(props: { ready: boolean }) {
  const { platform } = useServices();
  const unlock = useUnlock();
  const shortcut = useQuery({
    queryKey: ['native', 'hotkey'],
    queryFn: () => platform.shell.hotkeyStatus(),
  });
  const { mutate } = unlock;
  const ready = props.ready;
  const asked = useRef(false);

  // Ask once, the first time the window is in front while locked. It can lock while hidden, so
  // never on mount alone; and not again after Cancel, when focus comes back from Hello.
  useEffect(() => {
    if (!ready) return;
    const ask = () => {
      if (asked.current) return;
      asked.current = true;
      mutate('Unlock Avchetan');
    };
    if (document.hasFocus()) ask();
    window.addEventListener('focus', ask);
    return () => window.removeEventListener('focus', ask);
  }, [ready, mutate]);

  if (!ready) return <div className="h-screen bg-surface" />;

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <p aria-hidden className="text-4xl">
        🔒
      </p>
      <h1 className="text-lg font-semibold">Avchetan is locked</h1>
      <button
        type="button"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={unlock.isPending}
        onClick={() => unlock.mutate('Unlock Avchetan')}
      >
        Unlock with Windows Hello
      </button>
      <UnlockFeedback outcome={unlock.data} />
      {shortcut.data?.registered ? (
        <p className="text-sm text-ink-muted">
          You can still write things down: press <kbd>{shortcut.data.shortcut}</kbd>.
        </p>
      ) : null}
    </main>
  );
}

/** In the capture box, in place of recent entries and answers while the app is locked. */
export function DockLockedNotice() {
  const unlock = useUnlock();
  return (
    <div className="flex flex-col items-start gap-2 px-1 py-3 text-sm text-ink-muted">
      <p>🔒 Avchetan is locked. You can still write things down; earlier entries stay hidden.</p>
      <button
        type="button"
        className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface-raised hover:text-ink disabled:opacity-50"
        disabled={unlock.isPending}
        onClick={() => unlock.mutate('Unlock Avchetan')}
      >
        Unlock
      </button>
      <UnlockFeedback outcome={unlock.data} />
    </div>
  );
}
