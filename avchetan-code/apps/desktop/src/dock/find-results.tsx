import { parseCommand } from '@avchetan/core';
import { formatLocalDate, localDate } from '@avchetan/shared';
import { Highlighted } from '../main-window/ui';
import { useDockFind } from '../queries/search';
import { useDockStore } from '../stores/dock-store';
import { DOCK_LIST_ID, dockRowClass, dockRowId } from './dock-list';

/** The words after `/find`, or '' when the box holds something else. */
export function findWords(draft: string): string {
  const typed = parseCommand(draft);
  return typed?.command === 'find' ? typed.text : '';
}

/**
 * `/find words` (capture-box-redesign.md#find-in-the-capture-box): the first matches, the words
 * marked. ↑/↓ and Enter open an entry's day; Enter on the box opens Search with the words.
 */
export function FindResults(props: { words: string }) {
  const found = useDockFind(props.words);
  const highlight = useDockStore((state) => state.highlight);
  const hits = found.data ?? [];

  if (found.isSuccess && hits.length === 0) {
    return <p className="px-1 py-3 text-sm text-ink-muted">No entry has these words.</p>;
  }
  return (
    <div
      id={DOCK_LIST_ID}
      role="listbox"
      aria-label="Entries found"
      className="flex flex-col gap-1"
    >
      {hits.map((hit, index) => (
        <div
          key={hit.log.id}
          id={dockRowId(index)}
          role="option"
          tabIndex={-1}
          aria-selected={index === highlight}
          title={index === highlight ? 'Enter opens this day' : undefined}
          className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${dockRowClass(index === highlight)}`}
        >
          <span className="w-14 shrink-0 pt-px text-xs text-ink-muted">
            {formatLocalDate(localDate(hit.log.capturedAt, hit.log.capturedTz), {
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">
            <Highlighted parts={hit.parts} />
          </span>
        </div>
      ))}
    </div>
  );
}
