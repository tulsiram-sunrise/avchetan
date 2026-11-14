import { calendarDots, dayCategories, dayCategoryText, isSunday } from '@avchetan/core';
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
import { useEntryTags } from '../queries/collections';
import {
  useDayActivities,
  useDayEntries,
  useDayTasks,
  useMonthDots,
  useOverdueOpen,
  useResolvedCategories,
  useSetOverdueOpen,
  useToday,
} from '../queries/days';
import { useExtracted } from '../queries/organize';
import { useServices } from '../services-context';
import { useAppEvent } from '../use-app-event';
import { useColorScheme } from '../use-color-scheme';
import { DailyBrief } from './daily-brief';
import { isTyping } from './keys';
import { SyncWarningBanner } from './sync-warning-banner';
import { TimelineEntry } from './timeline';
import { TaskRow } from './timeline-items';
import { panelClass, QuietButton } from './ui';
import { WeekCard } from './week-card';

/**
 * One day at a time under a pinned week strip; the month drops down from it
 * (docs/product/days-view.md). Opens on today; ← and → move a day, Page Up and Page Down a
 * month, T goes back to today, M opens or closes the month, Esc closes it.
 */
export function DaysPage(props: {
  requestedDay?: string | null;
  /** An entry to bring into view on the requested day (opened from search). */
  requestedEntry?: string | null;
  /** Opens a tag's page (from a chip under an entry). */
  onOpenTag?: (path: string) => void;
}) {
  const today = useToday();
  const [day, setDay] = useState(props.requestedDay ?? today);
  const [month, setMonth] = useState<LocalMonth>(monthOf(props.requestedDay ?? today));
  const [monthOpen, setMonthOpen] = useState(false);

  const select = (next: string) => {
    setDay(next);
    setMonth(monthOf(next));
  };
  const toggleMonth = () => {
    // Opens on the selected day's month, wherever it was left.
    if (!monthOpen) setMonth(monthOf(day));
    setMonthOpen(!monthOpen);
  };

  // A brief notification opens its day.
  useAppEvent('main:navigate', (payload) => {
    if (payload.view === 'timeline' && payload.day) select(payload.day);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in a field must not move the day.
      if (isTyping(event.target)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'Escape' && monthOpen) {
        event.preventDefault();
        setMonthOpen(false);
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        toggleMonth();
        return;
      }
      const next = dayForKey(event.key, day, today);
      if (!next) return;
      event.preventDefault();
      select(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col">
      {/* Pinned to the top of the page's scroll area (main has p-6): the week never scrolls away. */}
      <div className="sticky -top-6 z-10 -mx-6 -mt-6 mb-4 border-b border-line bg-surface px-6 pt-6 pb-3">
        <WeekStrip
          day={day}
          today={today}
          monthOpen={monthOpen}
          onToggleMonth={toggleMonth}
          onDay={select}
        />
        {monthOpen ? (
          <>
            {/* A click outside closes the month. */}
            <button
              type="button"
              aria-label="Close the month"
              tabIndex={-1}
              className="fixed inset-0 z-0 cursor-default"
              onClick={() => setMonthOpen(false)}
            />
            <div className="absolute left-6 z-10 mt-2 w-80 rounded-xl border border-line bg-surface-raised p-3 shadow-lg">
              <MonthCalendar
                month={month}
                day={day}
                today={today}
                onMonth={setMonth}
                onDay={(next) => {
                  select(next);
                  setMonthOpen(false);
                }}
              />
            </div>
          </>
        ) : null}
      </div>
      <SyncWarningBanner />
      <DayPanel
        day={day}
        today={today}
        onToday={() => select(today)}
        entryInView={day === props.requestedDay ? (props.requestedEntry ?? null) : null}
        onOpenTag={props.onOpenTag}
      />
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

/** The selected day's week, with the month and year that open the whole month. */
function WeekStrip(props: {
  day: string;
  today: string;
  monthOpen: boolean;
  onToggleMonth: () => void;
  onDay: (day: string) => void;
}) {
  const week = useMemo(() => weekOf(props.day), [props.day]);
  const first = week[0] ?? props.day;
  const last = week[6] ?? props.day;
  // A week can cross two months.
  const firstDots = useMonthDots(monthOf(first));
  const lastDots = useMonthDots(monthOf(last));
  const categories = useResolvedCategories();
  const scheme = useColorScheme();
  const dotsOf = (date: string) =>
    (monthOf(date) === monthOf(first) ? firstDots : lastDots).data?.get(date);

  return (
    <section aria-label="Week" className="relative z-10 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={props.monthOpen}
          title="Show the whole month (M)"
          className="rounded-lg px-2 py-1 font-medium hover:bg-surface-raised"
          onClick={props.onToggleMonth}
        >
          {formatLocalDate(`${monthOf(props.day)}-01`, { month: 'long', year: 'numeric' })}{' '}
          <span aria-hidden="true">{props.monthOpen ? '▴' : '▾'}</span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Previous week"
          className="rounded-lg px-2 py-1 hover:bg-surface-raised"
          onClick={() => props.onDay(addDays(props.day, -7))}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next week"
          className="rounded-lg px-2 py-1 hover:bg-surface-raised"
          onClick={() => props.onDay(addDays(props.day, 7))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {week.map((date) => (
          <div key={date} className="flex flex-col items-center">
            <span className="text-xs text-ink-muted">
              {formatLocalDate(date, { weekday: 'short' })}
            </span>
            <CalendarDay
              date={date}
              inMonth
              selected={date === props.day}
              isToday={date === props.today}
              dots={dotsOf(date)}
              categories={categories.data}
              scheme={scheme}
              onSelect={() => props.onDay(date)}
            />
          </div>
        ))}
      </div>
    </section>
  );
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
    <section aria-label="Calendar" className="w-full">
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

function DayPanel(props: {
  day: string;
  today: string;
  onToday: () => void;
  entryInView: string | null;
  onOpenTag?: ((path: string) => void) | undefined;
}) {
  const { day, today } = props;
  const entries = useDayEntries(day);
  const dayActivities = useDayActivities(day);
  const tasks = useDayTasks(day, today);
  const categories = useResolvedCategories();
  const ids = useMemo(() => (entries.data ?? []).map((log) => log.id), [entries.data]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byLog(extracted.data?.tasks), [extracted.data]);
  const tagsOf = useEntryTags(ids);
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

      <DailyBrief
        day={day}
        today={today}
        hasEntries={(entries.data?.length ?? 0) > 0}
        summary={
          <Summary
            entries={entries.data?.length ?? 0}
            activities={dayActivities.data ?? []}
            doneTasks={
              (tasks.data?.done.length ?? 0) + (tasks.data?.due.filter(isDone).length ?? 0)
            }
            categories={categories.data}
          />
        }
      />

      {isSunday(day) && day <= today ? <WeekCard sunday={day} /> : null}

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
                inView={rawLog.id === props.entryInView}
                tagPaths={tagsOf(rawLog.id)}
                onOpenTag={props.onOpenTag}
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
    { title: 'Due', rows: tasks.due },
    { title: 'Done', rows: tasks.done },
  ].filter((group) => group.rows.length > 0);
  if (groups.length === 0 && tasks.overdue.length === 0) return null;
  return (
    <section aria-label="Tasks" className="flex flex-col gap-3">
      {tasks.overdue.length > 0 ? <OverdueTasks rows={tasks.overdue} /> : null}
      {groups.map((group) => (
        <div key={group.title}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
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

/**
 * Today's overdue tasks as one line, "▸ 7 overdue", closed until opened; the choice is
 * remembered (docs/product/finding-and-using-data.md#9-added-after-the-baseline).
 */
function OverdueTasks({ rows }: { rows: Task[] }) {
  const open = useOverdueOpen().data ?? false;
  const setOpen = useSetOverdueOpen();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="overdue-tasks"
        className="mb-2 flex items-center gap-1.5 text-sm font-medium text-danger hover:underline"
        onClick={() => setOpen.mutate(!open)}
      >
        <span aria-hidden="true" className="w-3">
          {open ? '▾' : '▸'}
        </span>
        {rows.length} overdue
      </button>
      {open ? (
        <ul id="overdue-tasks" className={`${panelClass} gap-0 [&>li]:px-4 [&>li]:py-2`}>
          {rows.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      ) : null}
    </div>
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
