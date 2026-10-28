import { formatTime } from '../format';
import { useRecentCaptures } from '../queries/raw-logs';
import { StatusBadge } from './status-badge';

export function RecentCaptures() {
  const recent = useRecentCaptures(5);
  const logs = recent.data ?? [];

  if (recent.isSuccess && logs.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-ink-muted">
        Nothing yet. Try: “Walked 30 minutes, remind me to buy milk tomorrow”.
      </p>
    );
  }

  return (
    <ul aria-label="Recent entries" className="flex flex-col gap-1">
      {logs.map((rawLog) => (
        <li
          key={rawLog.id}
          className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-raised"
        >
          <span className="w-11 shrink-0 pt-px text-xs tabular-nums text-ink-muted">
            {formatTime(rawLog.capturedAt)}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">
            {rawLog.content}
          </span>
          <StatusBadge status={rawLog.status} />
        </li>
      ))}
    </ul>
  );
}
