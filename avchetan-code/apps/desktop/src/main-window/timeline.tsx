import { windowContextOf } from '@avchetan/core';
import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { formatTime } from '@avchetan/shared';
import { StatusBadge } from '../dock/status-badge';
import { ActivityRow, EntryActions, TaskRow } from './timeline-items';

/**
 * One entry with what was extracted from it. `addedOn` is set when it shows on a day other than
 * the one it was typed (docs/product/days-view.md).
 */
export function TimelineEntry(props: {
  rawLog: RawLog;
  activities: Activity[];
  tasks: Task[];
  addedOn?: string | null;
}) {
  const { rawLog, activities, tasks } = props;
  const window = windowContextOf(rawLog.context);
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      <span className="w-12 shrink-0 tabular-nums text-ink-muted">
        {formatTime(rawLog.capturedAt)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {props.addedOn ? <p className="text-xs text-ink-muted">added on {props.addedOn}</p> : null}
        <p className="whitespace-pre-wrap break-words">{rawLog.content}</p>
        {window ? (
          <p className="text-xs text-ink-muted" title={window.window_title ?? window.app_name}>
            from {window.app_name}
          </p>
        ) : null}
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
