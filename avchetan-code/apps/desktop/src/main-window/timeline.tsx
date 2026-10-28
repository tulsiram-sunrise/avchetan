import type { RawLog } from '@avchetan/db/sqlite';
import { StatusBadge } from '../dock/status-badge';
import { formatDay, formatTime } from '../format';
import { useTimeline } from '../queries/raw-logs';

/** Everything captured, newest first, grouped by local day. Raw logs only in Phase 2. */
export function Timeline() {
  const timeline = useTimeline();
  const logs = timeline.data?.pages.flat() ?? [];

  if (timeline.isSuccess && logs.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No entries yet. Press Ctrl+Shift+Space anywhere to add one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groupByDay(logs).map(([day, dayLogs]) => (
        <section key={day} aria-label={day}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {day}
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface-raised">
            {dayLogs.map((rawLog) => (
              <li key={rawLog.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-ink-muted">
                  {formatTime(rawLog.capturedAt)}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {rawLog.content}
                </span>
                <StatusBadge status={rawLog.status} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {timeline.hasNextPage ? (
        <button
          type="button"
          className="self-center rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-raised"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Show older entries
        </button>
      ) : null}
    </div>
  );
}

function groupByDay(logs: RawLog[]): [string, RawLog[]][] {
  const groups = new Map<string, RawLog[]>();
  for (const rawLog of logs) {
    const day = formatDay(rawLog.capturedAt);
    const group = groups.get(day);
    if (group) group.push(rawLog);
    else groups.set(day, [rawLog]);
  }
  return [...groups];
}
