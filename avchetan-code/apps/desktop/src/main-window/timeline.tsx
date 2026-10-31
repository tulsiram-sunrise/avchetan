import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { formatDay, formatTime } from '@avchetan/shared';
import { useMemo } from 'react';
import { StatusBadge } from '../dock/status-badge';
import { useExtracted } from '../queries/organize';
import { useTimeline } from '../queries/raw-logs';
import { ActivityRow, EntryActions, TaskRow } from './timeline-items';

/** Everything captured, newest first, grouped by local day, with what was extracted from it. */
export function Timeline() {
  const timeline = useTimeline();
  const logs = useMemo(() => timeline.data?.pages.flat() ?? [], [timeline.data]);
  const ids = useMemo(() => logs.map((log) => log.id), [logs]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byLog(extracted.data?.tasks), [extracted.data]);

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
              <TimelineEntry
                key={rawLog.id}
                rawLog={rawLog}
                activities={activitiesOf.get(rawLog.id) ?? []}
                tasks={tasksOf.get(rawLog.id) ?? []}
              />
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

function TimelineEntry(props: { rawLog: RawLog; activities: Activity[]; tasks: Task[] }) {
  const { rawLog, activities, tasks } = props;
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      <span className="w-12 shrink-0 tabular-nums text-ink-muted">
        {formatTime(rawLog.capturedAt)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="whitespace-pre-wrap break-words">{rawLog.content}</p>
        {activities.length + tasks.length > 0 ? (
          <ul className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
            {activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        ) : null}
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">Options</summary>
          <div className="pt-2">
            <EntryActions rawLog={rawLog} />
          </div>
        </details>
      </div>
      <StatusBadge status={rawLog.status} />
    </li>
  );
}

function byLog<T extends { rawLogId: string | null }>(rows: T[] | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows ?? []) {
    if (!row.rawLogId) continue;
    groups.set(row.rawLogId, [...(groups.get(row.rawLogId) ?? []), row]);
  }
  return groups;
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
