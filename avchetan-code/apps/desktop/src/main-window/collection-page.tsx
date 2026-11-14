import { metricTotalText, topMetricTotals } from '@avchetan/core';
import {
  type Activity,
  type Collection,
  LIST_PAGE,
  type RawLog,
  type Task,
} from '@avchetan/db/sqlite';
import { formatDueDate, formatLocalDate, localDate } from '@avchetan/shared';
import { type ReactNode, useMemo, useState } from 'react';
import {
  useCollectionEntries,
  useCollectionOpenTasks,
  useCollectionSummary,
  useEntryTags,
} from '../queries/collections';
import { useToday } from '../queries/days';
import { useServices } from '../services-context';
import { TimelineEntry } from './timeline';
import { TaskRow } from './timeline-items';
import { panelClass, QuietButton, ShowMore } from './ui';

/**
 * One tag's or project's page (docs/product/finding-and-using-data.md#2-tag-and-project-pages):
 * counts and number totals, open tasks, and entries by day with the rows Days uses.
 */
export function CollectionPage(props: {
  of: Collection;
  /** `#health` or the project's name; may be editable. */
  title: ReactNode;
  color: string | null;
  back: { label: string; onBack: () => void };
  /** What to say when nothing carries it yet. */
  empty: string;
  onOpenTag: (path: string) => void;
  onOpenDay: (day: string) => void;
}) {
  const { timeZone } = useServices();
  const today = useToday();
  const summary = useCollectionSummary(props.of);
  const dayOf = (instant: string) => formatDueDate(localDate(instant, timeZone.current()), today);
  const data = summary.data;
  const facts = data
    ? [
        `${data.entries} ${data.entries === 1 ? 'entry' : 'entries'}`,
        `${data.openTasks} open ${data.openTasks === 1 ? 'task' : 'tasks'}`,
        data.firstUsed ? `first ${dayOf(data.firstUsed)}` : null,
        data.lastUsed ? `last ${dayOf(data.lastUsed)}` : null,
      ].filter(Boolean)
    : [];
  const totals = data ? topMetricTotals(data.metrics) : [];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="self-start text-xs text-ink-muted hover:underline"
          onClick={props.back.onBack}
        >
          ← {props.back.label}
        </button>
        <div className="flex items-center gap-2">
          {props.color ? (
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: props.color }}
            />
          ) : null}
          <h1 className="text-xl font-semibold">{props.title}</h1>
        </div>
        <p className="text-sm text-ink-muted">{facts.join(' · ')}</p>
        {totals.length > 0 ? (
          <ul aria-label="Totals" className="text-sm">
            {totals.map((total) => (
              <li key={total.key}>{metricTotalText(total)}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {data && data.entries + data.openTasks === 0 ? (
        <p className="max-w-xl text-sm text-ink-muted">{props.empty}</p>
      ) : null}
      {data && data.openTasks > 0 ? <OpenTasks of={props.of} total={data.openTasks} /> : null}
      {data && data.entries > 0 ? (
        <EntriesByDay
          of={props.of}
          total={data.entries}
          onOpenTag={props.onOpenTag}
          onOpenDay={props.onOpenDay}
        />
      ) : null}
    </div>
  );
}

function OpenTasks(props: { of: Collection; total: number }) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const tasks = useCollectionOpenTasks(props.of, limit);
  return (
    <section aria-label="Open tasks">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Open tasks ({props.total})
      </h2>
      <ul className={`${panelClass} gap-0 [&>li]:px-4 [&>li]:py-2`}>
        {(tasks.data ?? []).map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
      <ShowMore
        shown={tasks.data?.length ?? 0}
        total={props.total}
        onMore={() => setLimit((n) => n + LIST_PAGE)}
      />
    </section>
  );
}

const NO_ENTRIES: RawLog[] = [];
const NO_ACTIVITIES: Activity[] = [];
const NO_TASKS: Task[] = [];

/** Newest day first, 50 entries at a time; each day's title opens it on Days. */
function EntriesByDay(props: {
  of: Collection;
  total: number;
  onOpenTag: (path: string) => void;
  onOpenDay: (day: string) => void;
}) {
  const { timeZone } = useServices();
  const today = useToday();
  const [limit, setLimit] = useState(LIST_PAGE);
  const loaded = useCollectionEntries(props.of, limit);
  const entries = loaded.data?.entries ?? NO_ENTRIES;
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const activities = loaded.data?.activities ?? NO_ACTIVITIES;
  const tasks = loaded.data?.tasks ?? NO_TASKS;
  const tagsOf = useEntryTags(ids);
  const days = useMemo(() => {
    const zone = timeZone.current();
    const groups: { day: string; entries: RawLog[] }[] = [];
    for (const entry of entries) {
      const day = localDate(entry.capturedAt, zone);
      const last = groups.at(-1);
      if (last?.day === day) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [entries, timeZone]);
  return (
    <section aria-label="Entries" className="flex flex-col gap-4">
      {days.map((group) => (
        <div key={group.day}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <QuietButton onClick={() => props.onOpenDay(group.day)}>
              {group.day === today
                ? 'Today'
                : formatLocalDate(group.day, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: group.day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
                  })}
            </QuietButton>
          </h2>
          <ul className={panelClass}>
            {group.entries.map((rawLog) => (
              <TimelineEntry
                key={rawLog.id}
                rawLog={rawLog}
                activities={activities.filter((row) => row.rawLogId === rawLog.id)}
                tasks={tasks.filter((row) => row.rawLogId === rawLog.id)}
                tagPaths={tagsOf(rawLog.id)}
                onOpenTag={props.onOpenTag}
              />
            ))}
          </ul>
        </div>
      ))}
      <ShowMore
        shown={entries.length}
        total={props.total}
        onMore={() => setLimit((n) => n + LIST_PAGE)}
      />
    </section>
  );
}
