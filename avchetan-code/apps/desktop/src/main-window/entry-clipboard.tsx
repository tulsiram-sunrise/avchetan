import { clipboardOf } from '@avchetan/core';
import type { RawLog } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { useState } from 'react';

const log = createLogger('days');

/** *with clipboard* under an entry; opens to the copied text with Copy (clipboard-snap.md). */
export function EntryClipboard({ rawLog }: { rawLog: RawLog }) {
  const copied = clipboardOf(rawLog.context);
  const [done, setDone] = useState(false);
  if (!copied) return null;
  return (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer">with clipboard</summary>
      <div className="flex flex-col items-start gap-1 pt-1">
        <pre className="max-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-raised p-2 font-mono text-[11px] text-ink">
          {copied.text}
          {copied.cut ? '\n… (cut to 4 KB)' : ''}
        </pre>
        <button
          type="button"
          className="rounded px-1 underline hover:text-ink"
          onClick={() =>
            void navigator.clipboard.writeText(copied.text).then(
              () => setDone(true),
              () => log.warn('could not copy the attached text'),
            )
          }
        >
          {done ? 'Copied' : 'Copy'}
        </button>
      </div>
    </details>
  );
}
