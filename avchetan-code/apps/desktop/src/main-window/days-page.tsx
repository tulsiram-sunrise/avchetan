import { calendarDots, dayCategories, dayCategoryText } from '@avchetan/core';
import type { Activity, Category, MonthDay, RawLog, Task } from '@avchetan/db/sqlite';
import {
  addDays,
  addMonths,
  type ColorScheme,
  formatLocalDate,
  type LocalMonth,
  localDate,
  monthOf,
  monthWeeks,
  shiftMonth,
  weekOf,
} from '@avchetan/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  useDayActivities,
  useDayEntries,
  useDayTasks,
  useMonthDots,
  useResolvedCategories,
  useToday,
} from '../queries/days';
import { useExtracted } from '../queries/organize';
import { useServices } from '../services-context';
import { useColorScheme } from '../use-color-scheme';
import { TimelineEntry } from './timeline';
import { TaskRow } from './timeline-items';
import { panelClass, QuietButton } from './ui';

/**
 * One day at a time, with a month calendar beside it (docs/product/days-view.md). Opens on
 * today; ← and → move a day, Page Up and Page Down a month, T goes back to today.
 */
export function DaysPage() {
  const today = useToday();
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState<LocalMonth>(monthOf(today));

  const select = (next: string) => {
    setDay(next);
    setMonth(monthOf(next));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in a field must not move the day.
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const next = dayForKey(event.key, day, today);
      if (!next) return;
      event.preventDefault();
      select(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <MonthCalendar month={month} day={day} today={today} onMonth={setMonth} onDay={select} />
      <DayPanel day={day} today={today} onToday={() => select(today)} />
    </div>
  );
}

function dayForKey(key: string, day: string, today: string): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(day, -1);
    case 'ArrowRight':
      return addDays(day, 1);
    case 'PageUp':
      return shiftMonth(day, -1);
    case 'PageDown':
      return shiftMonth(day, 1);
    case 't':
    case 'T':
      return today;
    default:
      return null;
  }
}

function MonthCalendar(props: {
  month: LocalMonth;
  day: string;
  today: string;
  onMonth: (month: LocalMonth) => void;
  onDay: (day: string) => void;
}) {
  const dots = useMonthDots(props.month);
  const categories = useResolvedCategories();
  const scheme = useColorScheme();
  const weeks = useMemo(() => monthWeeks(props.month), [props.month]);
  const weekdays = weekOf(weeks[0]?.[0] ?? `${props.month}-01`);

  return (
    <section aria-label="Calendar" className="w-full max-w-sm shrink-0 md:w-64">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="rounded-lg px-2 py-1 hover:bg-surface-raised"
          onClick={() => props.onMonth(addMonths(props.month, -1))}
        >
          ‹
        </button>
        <h2 className="font-medium">
          {formatLocalDate(`${props.month}-01`, { month: 'long', year: 'numeric' })}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          className="rounded-lg px-2 py-1 hover:bg-surface-raised"
          onClick={() => props.onMonth(addMonths(props.month, 1))}
        >
          ›
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-center text-sm">
        <thead>
          <tr>
            {weekdays.map((date) => (
              <th key={date} scope="col" className="pb-1 text-xs font-normal text-ink-muted">
                {formatLocalDate(date, { weekday: 'narrow' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => (
                <td key={date} className="p-0.5">
                  <CalendarDay
                    date={date}
                    inMonth={monthOf(date) === props.month}
                    selected={date === props.day}
                    isToday={date === props.today}
                    dots={dots.data?.get(date)}
                    categories={categories.data}
                    scheme={scheme}
                    onSelect={() => props.onDay(date)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CalendarDay(props: {
  date: string;
  inMonth: boolean;
  selected: boolean;
  isToday: boolean;
  dots: MonthDay | undefined;
  categories: Map<string, Category> | undefined;
  scheme: ColorScheme;
  onSelect: () => void;
}) {
  const colors = calendarDots(props.dots, props.categories, props.scheme);
  const label = formatLocalDate(props.date, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={props.selected}
      aria-current={props.isToday ? 'date' : undefined}
      className={`group flex h-12 w-full flex-col items-center justify-center gap-1 rounded-lg ${
        props.inMonth || props.selected ? '' : 'text-ink-muted opacity-60'
      }`}
      onClick={props.onSelect}
    >
      {/* Only the number is highlighted, so the dots below keep their colours readable. */}
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full tabular-nums leading-none ${
          props.selected
            ? 'bg-accent font-semibold text-white'
            : props.isToday
              ? 'font-semibold text-accent ring-1 ring-accent'
              : 'group-hover:bg-surface-raised'
        }`}
      >
        {Number(props.date.slice(8, 10))}
      </span>
      <span className="flex h-1.5 gap-0.5" aria-hidden="true">
        {colors.map((dot) => (
          <span
            key={dot.key}
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: dot.color }}
          />
        ))}
      </span>
    </button>
  );
}

function DayPanel(props: { day: string; today: string; onToday: () => void }) {
  const { day, today } = props;
  const entries = useDayEntries(day);
  const dayActivities = useDayActivities(day);
  const tasks = useDayTasks(day, today);
  const categories = useResolvedCategories();
  const ids = useMemo(() => (entries.data ?? []).map((log) => log.id), [entries.data]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byLog(extracted.data?.tasks), [extracted.data]);
  const addedOn = useAddedOn();

  const title = formatLocalDate(day, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: monthOf(day).slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  });
  const isFuture = day > today;
  const nothing =
    entries.isSuccess &&
    tasks.isSuccess &&
    entries.data.length === 0 &&
    tasks.data.due.length + tasks.data.done.length + tasks.data.overdue.length === 0;

  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        {day === today ? (
          <span className="text-sm text-ink-muted">Today</span>
        ) : (
          <QuietButton onClick={props.onToday}>Today</QuietButton>
        )}
      </header>

      <Summary
        entries={entries.data?.length ?? 0}
        activities={dayActivities.data ?? []}
        doneTasks={(tasks.data?.done.length ?? 0) + (tasks.data?.due.filter(isDone).length ?? 0)}
        categories={categories.data}
      />

      {nothing ? (
        <p className="text-sm text-ink-muted">
          {isFuture
            ? 'Nothing due this day.'
            : day === today
              ? 'Nothing yet today. Press Ctrl+Shift+Space anywhere to add an entry.'
              : 'Nothing was logged this day.'}
        </p>
      ) : null}

      {tasks.data ? <DayTasks tasks={tasks.data} /> : null}

      {entries.data && entries.data.length > 0 ? (
        <section aria-label="Entries">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Entries
          </h2>
          <ul className={panelClass}>
            {entries.data.map((rawLog) => (
              <TimelineEntry
                key={rawLog.id}
                rawLog={rawLog}
                activities={activitiesOf.get(rawLog.id) ?? []}
                tasks={tasksOf.get(rawLog.id) ?? []}
                addedOn={addedOn(rawLog, day)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** "added on 5 Nov" for an entry that shows here because it talks about this day. */
function useAddedOn() {
  const { timeZone } = useServices();
  return (rawLog: RawLog, day: string) => {
    const typedOn = localDate(rawLog.capturedAt, timeZone.current());
    return typedOn === day ? null : formatLocalDate(typedOn, { day: 'numeric', month: 'short' });
  };
}

function Summary(props: {
  entries: number;
  activities: Activity[];
  doneTasks: number;
  categories: Map<string, Category> | undefined;
}) {
  const parts: string[] = [];
  if (props.entries > 0) parts.push(props.entries === 1 ? '1 entry' : `${props.entries} entries`);
  const resolve = (id: string) => props.categories?.get(id)?.id ?? id;
  for (const category of dayCategories(props.activities, resolve)) {
    const name = props.categories?.get(category.categoryId)?.name ?? '…';
    parts.push(dayCategoryText(category, name));
  }
  if (props.doneTasks > 0) {
    parts.push(props.doneTasks === 1 ? '1 task done' : `${props.doneTasks} tasks done`);
  }
  if (parts.length === 0) return null;
  return <p className="text-sm text-ink-muted">{parts.join(' · ')}</p>;
}

function DayTasks({ tasks }: { tasks: { due: Task[]; done: Task[]; overdue: Task[] } }) {
  const groups = [
    { title: 'Overdue', rows: tasks.overdue },
    { title: 'Due', rows: tasks.due },
    { title: 'Done', rows: tasks.done },
  ].filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <section aria-label="Tasks" className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.title}>
          <h2
            className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
              group.title === 'Overdue' ? 'text-danger' : 'text-ink-muted'
            }`}
          >
            {group.title}
          </h2>
          <ul className={`${panelClass} gap-0 [&>li]:px-4 [&>li]:py-2`}>
            {group.rows.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function isDone(task: Task): boolean {
  return task.completedAt !== null;
}

function byLog<T extends { rawLogId: string | null }>(rows: T[] | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows ?? []) {
    if (!row.rawLogId) continue;
    groups.set(row.rawLogId, [...(groups.get(row.rawLogId) ?? []), row]);
  }
  return groups;
}
