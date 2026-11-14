import { windowContextOf } from '@avchetan/core';
import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { formatTime } from '@avchetan/shared';
import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../dock/status-badge';
import { EntryClipboard } from './entry-clipboard';
import { PrivateLock, WaitsForLocalAi } from './private-mark';
import { ActivityRow, EntryActions, TaskRow } from './timeline-items';

/** How long an entry opened from search stays outlined. */
const OUTLINE_MS = 2500;

/**
 * One entry with what was extracted from it. `addedOn` is set when it shows on a day other than
 * the one it was typed (docs/product/days-view.md).
 */
export function TimelineEntry(props: {
  rawLog: RawLog;
  activities: Activity[];
  tasks: Task[];
  addedOn?: string | null;
  /** Opened from search: scrolled into view and outlined for a moment. */
  inView?: boolean;
  /** Tags on the entry or its activities; each chip opens its tag page. */
  tagPaths?: readonly string[];
  onOpenTag?: ((path: string) => void) | undefined;
}) {
  const { rawLog, activities, tasks } = props;
  const window = windowContextOf(rawLog.context);
  const row = useRef<HTMLLIElement>(null);
  const [outlined, setOutlined] = useState(false);
  useEffect(() => {
    if (!props.inView) return;
    row.current?.scrollIntoView({ block: 'center' });
    setOutlined(true);
    const timer = setTimeout(() => setOutlined(false), OUTLINE_MS);
    return () => clearTimeout(timer);
  }, [props.inView]);
  return (
    <li
      ref={row}
      className={`flex items-start gap-3 px-4 py-3 text-sm transition-shadow duration-700 ${
        outlined ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]' : ''
      }`}
    >
      <span className="w-12 shrink-0 tabular-nums text-ink-muted">
        {formatTime(rawLog.capturedAt)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {props.addedOn ? <p className="text-xs text-ink-muted">added on {props.addedOn}</p> : null}
        <p className="whitespace-pre-wrap break-words">
          <PrivateLock rawLog={rawLog} />
          {rawLog.content}
        </p>
        <TagChips paths={props.tagPaths ?? []} onOpen={props.onOpenTag} />
        <WaitsForLocalAi rawLog={rawLog} />
        {window ? (
          <p className="text-xs text-ink-muted" title={window.window_title ?? window.app_name}>
            from {window.app_name}
          </p>
        ) : null}
        <EntryClipboard rawLog={rawLog} />
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

/** Tag chips under an entry. Buttons when there's a tag page to open. */
export function TagChips(props: {
  paths: readonly string[];
  onOpen?: ((path: string) => void) | undefined;
}) {
  if (props.paths.length === 0) return null;
  const chip = 'rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted';
  return (
    <p className="flex flex-wrap gap-1.5">
      {props.paths.map((path) =>
        props.onOpen ? (
          <button
            key={path}
            type="button"
            className={`${chip} hover:text-accent hover:underline`}
            title={`Open #${path}`}
            onClick={() => props.onOpen?.(path)}
          >
            #{path}
          </button>
        ) : (
          <span key={path} className={chip}>
            #{path}
          </span>
        ),
      )}
    </p>
  );
}
