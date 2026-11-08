import type { PromiseLink, Task } from '@avchetan/db/sqlite';
import { useId, useState } from 'react';
import { useAction } from '../queries/organize';
import { usePeople, usePromiseLinks } from '../queries/people';
import { ActionError, fieldClass, QuietButton } from './ui';

export const promiseLabel = (link: PromiseLink) =>
  link.role === 'owed_to' ? `Promise to ${link.entity.name}` : `Waiting on ${link.entity.name}`;

/**
 * A task's promise links, each with **Not a promise**, and **Person…** to add one by hand
 * (docs/product/people-and-promises.md).
 */
export function TaskPromises(props: { task: Task; onOpenPerson?: (id: string) => void }) {
  const links = usePromiseLinks();
  const unlink = useAction('promise.unlink');
  const [adding, setAdding] = useState(false);
  const mine = links.data?.get(props.task.id) ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {mine.map((link) => (
        <span
          key={`${link.role}-${link.entity.id}`}
          className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5"
        >
          {props.onOpenPerson ? (
            <button
              type="button"
              className="hover:underline"
              onClick={() => props.onOpenPerson?.(link.entity.id)}
            >
              {promiseLabel(link)}
            </button>
          ) : (
            <span>{promiseLabel(link)}</span>
          )}
          <button
            type="button"
            className="text-ink-muted hover:text-danger"
            title="Not a promise"
            aria-label={`Not a promise: ${promiseLabel(link)}`}
            disabled={unlink.isPending}
            onClick={() => unlink.mutate({ taskId: props.task.id, entityId: link.entity.id })}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <AddPromise task={props.task} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className="text-ink-muted hover:underline"
          onClick={() => setAdding(true)}
        >
          Person…
        </button>
      )}
      <ActionError errors={[unlink.error]} />
    </div>
  );
}

function AddPromise(props: { task: Task; onDone: () => void }) {
  const people = usePeople();
  const link = useAction('promise.link');
  const listId = useId();
  const [role, setRole] = useState<'owed_to' | 'owed_by'>('owed_to');
  const [name, setName] = useState('');

  const submit = () => {
    const typed = name.trim();
    if (!typed) return;
    const known = people.data?.find((row) => row.entity.name.toLowerCase() === typed.toLowerCase());
    link.mutate(
      {
        taskId: props.task.id,
        role,
        person: known ? { id: known.entity.id } : { name: typed },
      },
      { onSuccess: props.onDone },
    );
  };

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <select
        aria-label="Kind of promise"
        className={`${fieldClass} text-xs`}
        value={role}
        onChange={(event) => setRole(event.target.value as 'owed_to' | 'owed_by')}
      >
        <option value="owed_to">Promise to</option>
        <option value="owed_by">Waiting on</option>
      </select>
      <input
        aria-label="Person"
        placeholder="Name"
        list={listId}
        className={`${fieldClass} w-36 text-xs`}
        value={name}
        // biome-ignore lint/a11y/noAutofocus: the user just asked to add a person
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onDone();
        }}
      />
      <datalist id={listId}>
        {people.data?.map((row) => (
          <option key={row.entity.id} value={row.entity.name} />
        ))}
      </datalist>
      <button
        type="submit"
        className="rounded-lg bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
        disabled={link.isPending || !name.trim()}
      >
        Add
      </button>
      <QuietButton onClick={props.onDone}>Cancel</QuietButton>
      <ActionError errors={[link.error]} />
    </form>
  );
}
