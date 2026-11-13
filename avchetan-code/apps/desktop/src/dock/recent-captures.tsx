import { isCommand } from '@avchetan/core';
import { formatTime } from '@avchetan/shared';
import { useRecentCaptures } from '../queries/raw-logs';
import { useDockStore } from '../stores/dock-store';
import { DOCK_LIST_ID, dockRowClass, dockRowId } from './dock-list';
import { StatusBadge } from './status-badge';

/** How many recent entries the dock shows; ↓ from an empty box moves through them. */
export const RECENT_SHOWN = 5;

export function RecentCaptures() {
  const recent = useRecentCaptures(RECENT_SHOWN);
  // While a command is typed, ↑/↓ move through the commands above, not these entries.
  const keyed = useDockStore((state) => !isCommand(state.draft));
  const highlight = useDockStore((state) => (keyed ? state.highlight : null));
  const logs = recent.data ?? [];

  if (recent.isSuccess && logs.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-ink-muted">
        Nothing yet. Try: “Walked 30 minutes, remind me to buy milk tomorrow”.
      </p>
    );
  }

  return (
    <div
      id={keyed ? DOCK_LIST_ID : undefined}
      role="listbox"
      aria-label="Recent entries"
      className="flex flex-col gap-1"
    >
      {logs.map((rawLog, index) => (
        <div
          key={rawLog.id}
          id={keyed ? dockRowId(index) : undefined}
          role="option"
          tabIndex={-1}
          aria-selected={index === highlight}
          title={index === highlight ? 'Enter opens this day' : undefined}
          className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${dockRowClass(index === highlight)}`}
        >
          <span className="w-11 shrink-0 pt-px text-xs tabular-nums text-ink-muted">
            {formatTime(rawLog.capturedAt)}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">
            {rawLog.content}
          </span>
          <StatusBadge status={rawLog.status} />
        </div>
      ))}
    </div>
  );
}
