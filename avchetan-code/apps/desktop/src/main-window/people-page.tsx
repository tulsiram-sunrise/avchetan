import type { EntitySummary, PromiseItem } from '@avchetan/db/sqlite';
import { createLogger, formatDueDate, localDate } from '@avchetan/shared';
import { useState } from 'react';
import { emitAppEvent } from '../native/events';
import { useToday } from '../queries/days';
import { useAction } from '../queries/organize';
import {
  useDismissPair,
  useDuplicateSuggestions,
  useEntriesToRecheck,
  usePeople,
  usePerson,
  usePersonEntries,
} from '../queries/people';
import { PrivateLock } from './private-mark';
import { ActionError, EditableText, MergeSelect, panelClass, QuietButton } from './ui';

const log = createLogger('people');

const shortDay = formatDueDate;

/** The People page: everyone your entries name, and what you and they promised. */
export function PeoplePage() {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) return <PersonPage id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} />;
  return <PeopleList onOpen={setOpenId} />;
}

function summaryLine(row: EntitySummary, today: string): string {
  const parts: string[] = [];
  if (row.youOwe > 0) parts.push(`You owe ${row.youOwe}`);
  if (row.waitingOn > 0) parts.push(`Waiting on ${row.waitingOn}`);
  if (row.overdue > 0) parts.push(`${row.overdue} overdue`);
  const seen = row.lastSeen ?? row.lastMentioned;
  if (seen) parts.push(`${row.lastSeen ? 'last seen' : 'last mentioned'} ${shortDay(seen, today)}`);
  return parts.join(' · ');
}

function PeopleList(props: { onOpen: (id: string) => void }) {
  const today = useToday();
  const people = usePeople();
  const suggestions = useDuplicateSuggestions();
  const [search, setSearch] = useState('');
  const rows = (people.data ?? []).filter((row) =>
    [row.entity.name, ...row.entity.aliases].some((name) =>
      name.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );

  if (people.isSuccess && people.data.length === 0) {
    return (
      <p className="max-w-xl text-sm text-ink-muted">
        No people yet. Name someone in an entry, like "lunch with Priya, need to send her the
        photos", and they show up here with what you promised.
      </p>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <input
        aria-label="Search people"
        placeholder="Search people…"
        className="rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {suggestions.length > 0 && !search ? <Suggestions /> : null}
      {search ? null : <Recheck />}
      <ul className={panelClass}>
        {rows.map((row) => (
          <li key={row.entity.id}>
            <button
              type="button"
              className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface"
              onClick={() => props.onOpen(row.entity.id)}
            >
              <span className="font-medium">
                {row.onlyPrivate ? <PrivateLock rawLog={{ privacy: 'local_only' }} /> : null}
                {row.entity.name}
              </span>
              <span className={`text-xs ${row.overdue > 0 ? 'text-danger' : 'text-ink-muted'}`}>
                {summaryLine(row, today)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Recheck() {
  const toRecheck = useEntriesToRecheck();
  const recheck = useAction('people.recheckPromises');
  const count = toRecheck.data?.length ?? 0;
  if (count === 0 && !recheck.isSuccess) return null;
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2 text-sm">
      {recheck.isSuccess ? (
        <span className="text-ink-muted">
          Looking for promises in older entries. They are organized again in the background.
        </span>
      ) : (
        <>
          <span>
            {count === 1 ? '1 older entry' : `${count} older entries`} name someone and have a task.
            Organize them again to find promises?
          </span>
          <span className="text-xs text-ink-muted">
            Uses your AI for each one. Private entries wait for a local AI, and tasks you edited
            stay as they are.
          </span>
          <div>
            <QuietButton disabled={recheck.isPending} onClick={() => recheck.mutate({})}>
              Look for promises in older entries
            </QuietButton>
          </div>
        </>
      )}
      <ActionError errors={[recheck.error]} />
    </section>
  );
}

function Suggestions() {
  const suggestions = useDuplicateSuggestions();
  const merge = useAction('entity.merge');
  const dismiss = useDismissPair();
  return (
    <section aria-label="Same person?" className="flex flex-col gap-2 text-sm">
      {suggestions.slice(0, 3).map(({ a, b }) => (
        <div
          key={`${a.id}-${b.id}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2"
        >
          <span>
            Same person? <strong>{a.name}</strong> / <strong>{b.name}</strong>
          </span>
          <QuietButton
            disabled={merge.isPending}
            onClick={() => merge.mutate({ id: a.id, intoId: b.id })}
          >
            Merge into {b.name}
          </QuietButton>
          <QuietButton
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ a: a.id, b: b.id })}
          >
            No
          </QuietButton>
        </div>
      ))}
      <ActionError errors={[merge.error, dismiss.error]} />
    </section>
  );
}

function PersonPage(props: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const today = useToday();
  const person = usePerson(props.id);
  const people = usePeople();
  const rename = useAction('entity.rename');
  const merge = useAction('entity.merge');
  const [confirmInto, setConfirmInto] = useState<{ id: string; name: string } | null>(null);
  const detail = person.data;

  if (person.isSuccess && !detail) {
    // Merged away or deleted on another device.
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink-muted">This person isn't here any more.</p>
        <QuietButton onClick={props.onBack}>Back to People</QuietButton>
      </div>
    );
  }
  if (!detail) return null;

  const { entity } = detail;
  const youOwe = detail.open.filter((item) => item.role === 'owed_to');
  const waiting = detail.open.filter((item) => item.role === 'owed_by');
  const others = (people.data ?? [])
    .filter((row) => row.entity.id !== entity.id)
    .map((row) => ({ id: row.entity.id, label: row.entity.name }));

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="self-start text-xs text-ink-muted hover:underline"
          onClick={props.onBack}
        >
          ← People
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            <EditableText
              value={entity.name}
              label="name"
              onSave={(name) => rename.mutate({ id: entity.id, name })}
            />
          </h1>
          {others.length > 0 ? (
            <MergeSelect
              options={others}
              onMerge={(intoId) => {
                const into = others.find((option) => option.id === intoId);
                setConfirmInto(into ? { id: into.id, name: into.label } : null);
              }}
            />
          ) : null}
        </div>
        <p className="text-sm text-ink-muted">
          {[
            detail.lastSeen ? `Last seen ${shortDay(detail.lastSeen, today)}` : null,
            `${detail.rawLogIds.length} ${detail.rawLogIds.length === 1 ? 'entry' : 'entries'}`,
            entity.aliases.length > 0 ? `also ${entity.aliases.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {confirmInto ? (
          <div
            role="alertdialog"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
          >
            <span>
              Merge {entity.name} into {confirmInto.name}? Everything moves there, and this can't be
              undone.
            </span>
            <QuietButton
              disabled={merge.isPending}
              onClick={() =>
                merge.mutate(
                  { id: entity.id, intoId: confirmInto.id },
                  { onSuccess: () => props.onOpen(confirmInto.id) },
                )
              }
            >
              Merge
            </QuietButton>
            <QuietButton onClick={() => setConfirmInto(null)}>Cancel</QuietButton>
          </div>
        ) : null}
        <ActionError errors={[rename.error, merge.error]} />
      </div>

      <PromiseGroup title="You owe" items={youOwe} today={today} />
      <PromiseGroup title={`Waiting on ${entity.name}`} items={waiting} today={today} />
      {youOwe.length === 0 && waiting.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No open promises. On any task, use <strong>Person…</strong> to add one.
        </p>
      ) : null}
      {detail.done.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Done ({detail.done.length})
          </summary>
          <ul className={`${panelClass} mt-2`}>
            {detail.done.map((item) => (
              <PromiseLine key={`${item.role}-${item.task.id}`} item={item} today={today} />
            ))}
          </ul>
        </details>
      ) : null}

      <Entries rawLogIds={detail.rawLogIds} />
    </div>
  );
}

function PromiseGroup(props: { title: string; items: PromiseItem[]; today: string }) {
  if (props.items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {props.title} ({props.items.length})
      </h2>
      <ul className={panelClass}>
        {props.items.map((item) => (
          <PromiseLine key={`${item.role}-${item.task.id}`} item={item} today={props.today} />
        ))}
      </ul>
    </section>
  );
}

function PromiseLine(props: { item: PromiseItem; today: string }) {
  const { task } = props.item;
  const setDone = useAction('task.setDone');
  const unlink = useAction('promise.unlink');
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < props.today;
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Done: ${task.title}`}
          checked={done}
          disabled={setDone.isPending}
          onChange={(event) => setDone.mutate({ id: task.id, done: event.target.checked })}
        />
        <span className={`min-w-0 flex-1 ${done ? 'text-ink-muted line-through' : ''}`}>
          {task.title}
        </span>
        {task.dueDate ? (
          <span className={`text-xs ${overdue ? 'text-danger' : 'text-ink-muted'}`}>
            due {shortDay(task.dueDate, props.today)}
            {overdue ? ' (overdue)' : ''}
          </span>
        ) : null}
        <QuietButton
          disabled={unlink.isPending}
          onClick={() => unlink.mutate({ taskId: task.id, entityId: props.item.entity.id })}
        >
          Not a promise
        </QuietButton>
      </div>
      <ActionError errors={[setDone.error, unlink.error]} />
    </li>
  );
}

function Entries(props: { rawLogIds: string[] }) {
  const entries = usePersonEntries(props.rawLogIds);
  const today = useToday();
  if (props.rawLogIds.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Entries</h2>
      <ul className={panelClass}>
        {(entries.data ?? []).map((entry) => {
          const day = localDate(entry.capturedAt, entry.capturedTz);
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface"
                title="Open this day"
                onClick={() =>
                  void emitAppEvent('main:navigate', { view: 'timeline', day }).catch(() =>
                    log.warn('could not open a day'),
                  )
                }
              >
                <span className="w-24 shrink-0 text-xs text-ink-muted">{shortDay(day, today)}</span>
                <span className="min-w-0 flex-1 break-words">
                  <PrivateLock rawLog={entry} />
                  {entry.content}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
