import type { EntitySummary, HighlightPart } from '@avchetan/db/sqlite';
import { formatDueDate, formatTime, localDate } from '@avchetan/shared';
import { useEffect, useRef, useState } from 'react';
import { useResolvedCategories, useToday } from '../queries/days';
import { SEARCH_PAGE, useSearchEntries, useSearchPeople, useSearchTasks } from '../queries/search';
import { useServices } from '../services-context';
import { fieldClass, panelClass, QuietButton } from './ui';

/** Waits this long after the last key before searching, so each keystroke doesn't query. */
const TYPING_PAUSE_MS = 120;

/**
 * Plain search (docs/product/finding-and-using-data.md#1-plain-search): the words you typed,
 * on this PC, with no AI. Ctrl+F opens it from anywhere in the main window. The text is kept
 * by the main window, so coming back from a result shows the same results.
 */
export function SearchPage(props: {
  text: string;
  onText: (text: string) => void;
  /** Bumped by Ctrl+F: focus and select the box again. */
  focusSignal: number;
  onOpenEntry: (day: string, rawLogId: string) => void;
  onOpenTasks: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(props.text);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(props.text.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [props.text]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusSignal is the trigger.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [props.focusSignal]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <h1 className="text-lg font-semibold">Search</h1>
      <input
        ref={input}
        type="search"
        aria-label="Search your entries, tasks and people"
        placeholder="Search your entries, tasks and people"
        className={`${fieldClass} px-3 py-2 text-base`}
        value={props.text}
        onChange={(event) => props.onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && props.text) {
            event.preventDefault();
            props.onText('');
          }
        }}
      />
      {query ? (
        <Results query={query} {...props} />
      ) : (
        <p className="text-sm text-ink-muted">
          Finds the words you typed, on this PC, with no AI. The start of a word is enough:{' '}
          <em>dent</em> finds <em>dentist</em>. With several words, all of them must be there.
        </p>
      )}
    </div>
  );
}

function Results(props: {
  query: string;
  onOpenEntry: (day: string, rawLogId: string) => void;
  onOpenTasks: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const { query } = props;
  const [limits, setLimits] = useState({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE });
  // A new search starts from the first page again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the trigger.
  useEffect(() => setLimits({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE }), [query]);
  const entries = useSearchEntries(query, limits.entries);
  const tasks = useSearchTasks(query, limits.tasks);
  const people = useSearchPeople(query, SEARCH_PAGE);

  const loaded = entries.isSuccess && tasks.isSuccess && people.isSuccess;
  const none =
    loaded && entries.data.hits.length + tasks.data.hits.length + people.data.people.length === 0;
  if (none) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing matches <strong>{query}</strong>. Try fewer words, or the start of a word.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {entries.data && entries.data.hits.length > 0 ? (
        <Group
          title="Entries"
          more={entries.data.more}
          onMore={() => setLimits((l) => ({ ...l, entries: l.entries + SEARCH_PAGE }))}
        >
          {entries.data.hits.map((hit) => (
            <EntryResult key={hit.log.id} hit={hit} onOpen={props.onOpenEntry} />
          ))}
        </Group>
      ) : null}
      {tasks.data && tasks.data.hits.length > 0 ? (
        <Group
          title="Tasks"
          more={tasks.data.more}
          onMore={() => setLimits((l) => ({ ...l, tasks: l.tasks + SEARCH_PAGE }))}
        >
          {tasks.data.hits.map((hit) => (
            <TaskResult key={hit.task.id} hit={hit} onOpen={props.onOpenTasks} />
          ))}
        </Group>
      ) : null}
      {people.data && people.data.people.length > 0 ? (
        <Group title="People">
          {people.data.people.map((person) => (
            <PersonResult key={person.entity.id} person={person} onOpen={props.onOpenPerson} />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function Group(props: {
  title: string;
  more?: boolean;
  onMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {props.title}
      </h2>
      <ul className={panelClass}>{props.children}</ul>
      {props.more && props.onMore ? (
        <div>
          <QuietButton onClick={props.onMore}>Show more</QuietButton>
        </div>
      ) : null}
    </section>
  );
}

/** Text with the words the search found marked. */
export function Highlighted(props: { parts: readonly HighlightPart[] }) {
  return (
    <>
      {props.parts.map((part, index) =>
        part.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder.
          <mark key={index} className="rounded-sm bg-accent/30 px-0.5 text-ink">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder.
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const rowClass =
  'flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-surface focus-visible:bg-surface';

type EntryHitRow = NonNullable<ReturnType<typeof useSearchEntries>['data']>['hits'][number];

function EntryResult(props: { hit: EntryHitRow; onOpen: (day: string, id: string) => void }) {
  const { hit } = props;
  const { timeZone } = useServices();
  const today = useToday();
  const categories = useResolvedCategories();
  // The day Days shows it on: typed on this PC's calendar.
  const day = localDate(hit.log.capturedAt, timeZone.current());
  const names = hit.categoryIds
    .map((id) => categories.data?.get(id)?.name)
    .filter((name): name is string => Boolean(name));
  return (
    <li>
      <button type="button" className={rowClass} onClick={() => props.onOpen(day, hit.log.id)}>
        <span className="text-xs text-ink-muted">
          {formatDueDate(day, today)} · {formatTime(hit.log.capturedAt)}
        </span>
        <span className="line-clamp-4 whitespace-pre-wrap break-words">
          <Highlighted parts={hit.parts} />
        </span>
        {names.length + hit.tags.length > 0 ? (
          <span className="flex flex-wrap gap-1.5 text-xs text-ink-muted">
            {names.map((name) => (
              <span key={name} className="rounded-full border border-line px-2">
                {name}
              </span>
            ))}
            {hit.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </span>
        ) : null}
      </button>
    </li>
  );
}

type TaskHitRow = NonNullable<ReturnType<typeof useSearchTasks>['data']>['hits'][number];

function TaskResult(props: { hit: TaskHitRow; onOpen: () => void }) {
  const { task, parts } = props.hit;
  const today = useToday();
  const done = task.completedAt !== null;
  return (
    <li>
      <button type="button" className={rowClass} onClick={props.onOpen}>
        <span className={done ? 'text-ink-muted line-through' : undefined}>
          <Highlighted parts={parts} />
        </span>
        <span className="text-xs text-ink-muted">
          {done ? 'Done' : 'Open'}
          {task.dueDate ? ` · due ${formatDueDate(task.dueDate, today)}` : ''}
        </span>
      </button>
    </li>
  );
}

function PersonResult(props: { person: EntitySummary; onOpen: (id: string) => void }) {
  const { entity, lastSeen, lastMentioned } = props.person;
  const today = useToday();
  const seen = lastSeen ?? lastMentioned;
  return (
    <li>
      <button type="button" className={rowClass} onClick={() => props.onOpen(entity.id)}>
        <span className="font-medium">{entity.name}</span>
        {seen ? (
          <span className="text-xs text-ink-muted">
            {lastSeen ? 'Last seen' : 'Last mentioned'} {formatDueDate(seen, today)}
          </span>
        ) : null}
      </button>
    </li>
  );
}
