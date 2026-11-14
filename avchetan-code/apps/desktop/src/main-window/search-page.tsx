import {
  choiceIsSet,
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  type DatePreset,
  type FilterChoice,
  NO_FILTERS,
  toSearchFilters,
} from '@avchetan/core';
import type { PersonSummary, RawLog } from '@avchetan/db/sqlite';
import { formatDueDate, formatTime, localDate } from '@avchetan/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useResolvedCategories, useToday } from '../queries/days';
import { useActiveCategories, useProjects, useTags } from '../queries/organize';
import { usePeople } from '../queries/people';
import {
  SEARCH_PAGE,
  useSearchEntries,
  useSearchPeople,
  useSearchTasks,
  useSimilarEntries,
} from '../queries/search';
import { useServices } from '../services-context';
import { fieldClass, Highlighted, panelClass, QuietButton } from './ui';

/** Waits this long after the last key before searching, so each keystroke doesn't query. */
const TYPING_PAUSE_MS = 120;

/**
 * Plain search (docs/product/finding-and-using-data.md#1-plain-search): the words you typed,
 * on this PC, with no AI, narrowed by the filters; the hub's *Similar entries* below when it
 * can be reached. Ctrl+F opens it from anywhere in the main window. The text and filters are
 * kept by the main window, so coming back from a result shows the same results.
 */
export function SearchPage(props: {
  text: string;
  onText: (text: string) => void;
  choice: FilterChoice;
  onChoice: (choice: FilterChoice) => void;
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
    <div className="flex max-w-3xl flex-col gap-4">
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
      <FilterBar choice={props.choice} onChoice={props.onChoice} />
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

const selectClass = `${fieldClass} max-w-44`;

/** Date, tag, category, project and person. Each list holds only what exists. */
function FilterBar(props: { choice: FilterChoice; onChoice: (choice: FilterChoice) => void }) {
  const { choice, onChoice } = props;
  const today = useToday();
  const tags = useTags();
  const categories = useActiveCategories();
  const projects = useProjects();
  const people = usePeople();
  const set = (patch: Partial<FilterChoice>) => onChoice({ ...choice, ...patch });
  const orNone = (value: string) => (value === '' ? undefined : value);
  const tagPaths = (tags.data ?? [])
    .filter((tag) => !tag.mergedIntoId)
    .map((tag) => tag.path)
    .sort();

  return (
    <fieldset aria-label="Filters" className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="When"
        className={selectClass}
        value={choice.preset}
        onChange={(event) => set({ preset: event.target.value as DatePreset })}
      >
        {DATE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {DATE_PRESET_LABELS[preset]}
          </option>
        ))}
      </select>
      {choice.preset === 'custom' ? (
        <>
          <input
            type="date"
            aria-label="From"
            className={fieldClass}
            value={choice.customFrom ?? ''}
            onChange={(event) => set({ customFrom: event.target.value })}
          />
          <span className="text-ink-muted">to</span>
          <input
            type="date"
            aria-label="To"
            className={fieldClass}
            value={choice.customTo ?? ''}
            onChange={(event) => set({ customTo: event.target.value })}
          />
        </>
      ) : null}
      <select
        aria-label="Tag"
        className={selectClass}
        value={choice.tagPath ?? ''}
        onChange={(event) => set({ tagPath: orNone(event.target.value) })}
      >
        <option value="">Any tag</option>
        {tagPaths.map((path) => (
          <option key={path} value={path}>
            #{path}
          </option>
        ))}
      </select>
      <select
        aria-label="Category"
        className={selectClass}
        value={choice.categoryId ?? ''}
        onChange={(event) => set({ categoryId: orNone(event.target.value) })}
      >
        <option value="">Any category</option>
        {(categories.data ?? []).map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {(projects.data ?? []).length > 0 ? (
        <select
          aria-label="Project"
          className={selectClass}
          value={choice.projectId ?? ''}
          onChange={(event) => set({ projectId: orNone(event.target.value) })}
        >
          <option value="">Any project</option>
          {(projects.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      ) : null}
      {(people.data ?? []).length > 0 ? (
        <select
          aria-label="Person"
          className={selectClass}
          value={choice.personId ?? ''}
          onChange={(event) => set({ personId: orNone(event.target.value) })}
        >
          <option value="">Anyone</option>
          {(people.data ?? []).map((person) => (
            <option key={person.entity.id} value={person.entity.id}>
              {person.entity.name}
            </option>
          ))}
        </select>
      ) : null}
      {choiceIsSet(choice, today) ? (
        <QuietButton onClick={() => onChoice(NO_FILTERS)}>Clear filters</QuietButton>
      ) : null}
    </fieldset>
  );
}

function Results(props: {
  query: string;
  choice: FilterChoice;
  onOpenEntry: (day: string, rawLogId: string) => void;
  onOpenTasks: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const { query, choice } = props;
  const { timeZone } = useServices();
  const today = useToday();
  const filtered = choiceIsSet(choice, today);
  const zone = timeZone.current();
  const filters = useMemo(() => toSearchFilters(choice, today, zone), [choice, today, zone]);
  const [limits, setLimits] = useState({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE });
  // A new search starts from the first page again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query and filters are the trigger.
  useEffect(() => setLimits({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE }), [query, filters]);
  const entries = useSearchEntries(query, filters, limits.entries);
  const tasks = useSearchTasks(query, filters, limits.tasks);
  const people = useSearchPeople(query, SEARCH_PAGE, !filtered);
  const wordIds = useMemo(
    () => (entries.isSuccess ? entries.data.hits.map((hit) => hit.log.id) : undefined),
    [entries.isSuccess, entries.data],
  );
  const similar = useSimilarEntries(query, filters, wordIds);

  const peopleShown = filtered ? [] : (people.data?.people ?? []);
  const loaded = entries.isSuccess && tasks.isSuccess && (filtered || people.isSuccess);
  const none =
    loaded && entries.data.hits.length + tasks.data.hits.length + peopleShown.length === 0;
  const similarShown = (similar.data ?? []).filter((log) => !wordIds?.includes(log.id));

  return (
    <div className="flex flex-col gap-6">
      {none ? (
        <p className="text-sm text-ink-muted">
          Nothing matches <strong>{query}</strong>
          {filtered ? ' with these filters' : ''}. Try fewer words, or the start of a word.
        </p>
      ) : null}
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
      {peopleShown.length > 0 ? (
        <Group title="People">
          {peopleShown.map((person) => (
            <PersonResult key={person.entity.id} person={person} onOpen={props.onOpenPerson} />
          ))}
        </Group>
      ) : null}
      {similarShown.length > 0 ? (
        <Group title="Similar entries" note="Found by meaning on your hub">
          {similarShown.map((log) => (
            <SimilarResult key={log.id} log={log} onOpen={props.onOpenEntry} />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

/** An entry the hub found by meaning: no words to mark. */
function SimilarResult(props: { log: RawLog; onOpen: (day: string, id: string) => void }) {
  const { log } = props;
  const { timeZone } = useServices();
  const today = useToday();
  const day = localDate(log.capturedAt, timeZone.current());
  return (
    <li>
      <button type="button" className={rowClass} onClick={() => props.onOpen(day, log.id)}>
        <span className="text-xs text-ink-muted">
          {formatDueDate(day, today)} · {formatTime(log.capturedAt)}
        </span>
        <span className="line-clamp-4 whitespace-pre-wrap break-words">{log.content}</span>
      </button>
    </li>
  );
}

function Group(props: {
  title: string;
  /** A quiet line after the title. */
  note?: string;
  more?: boolean;
  onMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {props.title}
        {props.note ? (
          <span className="ml-2 font-normal normal-case tracking-normal">{props.note}</span>
        ) : null}
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

function PersonResult(props: { person: PersonSummary; onOpen: (id: string) => void }) {
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
