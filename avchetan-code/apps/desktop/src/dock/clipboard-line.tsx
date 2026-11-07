import type { DockClipboard } from '@avchetan/core';
import { useEffect, useState } from 'react';
import { useDockStore } from '../stores/dock-store';

/** How long a "nothing attached" note stays. */
const NOTE_MS = 4000;

const NOTES: Record<Extract<DockClipboard, { kind: 'none' }>['reason'], string> = {
  empty: 'Clipboard is empty',
  not_text: 'Clipboard has no text',
  private: 'Not attached: the clipboard came from an app that marks it private',
  denied: 'Not attached: Avchetan never notes this app',
  busy: "Couldn't read the clipboard, try again",
};

/**
 * Under the capture box: the clipboard text the next entry is saved with. Click to see all of
 * it, × to drop it from this entry (clipboard-snap.md#what-it-looks-like).
 */
export function ClipboardLine() {
  const clipboard = useDockStore((state) => state.clipboard);
  const setClipboard = useDockStore((state) => state.setClipboard);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (clipboard?.kind !== 'none') return;
    const timer = setTimeout(() => setClipboard(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [clipboard, setClipboard]);

  if (!clipboard) return null;
  if (clipboard.kind === 'none') {
    return (
      <p role="status" className="px-1 pt-1 text-xs text-ink-muted">
        {NOTES[clipboard.reason]}
      </p>
    );
  }

  const firstLine = clipboard.text.trim().split('\n')[0] ?? '';
  return (
    <div className="px-1 pt-1 text-xs text-ink-muted">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={open}
          title={open ? 'Hide the copied text' : 'Show all the copied text'}
          className="min-w-0 flex-1 truncate text-left hover:text-ink"
          onClick={() => setOpen(!open)}
        >
          <span className="text-ink">Clipboard</span> · {firstLine}
        </button>
        <button
          type="button"
          aria-label="Don't save the clipboard with this entry"
          title="Don't save the clipboard with this entry"
          className="rounded px-1 hover:bg-line hover:text-ink"
          onClick={() => setClipboard(null)}
        >
          ×
        </button>
      </div>
      {open ? (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-raised p-2 font-mono text-[11px] text-ink">
          {clipboard.text}
          {clipboard.cut ? '\n… (cut to 4 KB)' : ''}
        </pre>
      ) : null}
    </div>
  );
}
