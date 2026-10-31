import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { useState } from 'react';
import { useAction, useActiveCategories, useCategoryNames } from '../queries/organize';
import { ActionError, EditableText, fieldClass, QuietButton } from './ui';

function metricsText(metrics: Record<string, unknown>): string {
  return Object.entries(metrics)
    .filter(([key]) => key !== 'exercises')
    .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`)
    .join(' · ');
}

function exerciseLines(metrics: Record<string, unknown>): string[] {
  const list = Array.isArray(metrics.exercises) ? metrics.exercises : [];
  return list.map((raw) => {
    const item = raw as { name: string; sets?: number; reps?: number; weight_kg?: number };
    const volume = item.sets && item.reps ? ` ${item.sets}×${item.reps}` : '';
    return `${item.name}${volume}${item.weight_kg ? ` @ ${item.weight_kg} kg` : ''}`;
  });
}

export function ActivityRow({ activity }: { activity: Activity }) {
  const names = useCategoryNames();
  const categories = useActiveCategories();
  const edit = useAction('activity.edit');
  const remove = useAction('activity.delete');
  const metrics = metricsText(activity.metrics);
  const isActive = categories.data?.some((category) => category.id === activity.categoryId);

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Category"
          className={`${fieldClass} text-xs`}
          value={activity.categoryId}
          onChange={(event) => edit.mutate({ id: activity.id, categoryId: event.target.value })}
        >
          {isActive ? null : (
            <option value={activity.categoryId}>
              {names.data?.get(activity.categoryId) ?? '…'}
            </option>
          )}
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <EditableText
          value={activity.title}
          label="activity title"
          onSave={(title) => edit.mutate({ id: activity.id, title })}
        />
        {activity.isUserEdited ? <span className="text-xs text-ink-muted">edited</span> : null}
        <QuietButton disabled={remove.isPending} onClick={() => remove.mutate({ id: activity.id })}>
          Delete
        </QuietButton>
      </div>
      {metrics ? <p className="text-xs text-ink-muted">{metrics}</p> : null}
      {exerciseLines(activity.metrics).map((line) => (
        <p key={line} className="text-xs text-ink-muted">
          {line}
        </p>
      ))}
      <ActionError errors={[edit.error, remove.error]} />
    </li>
  );
}

export function TaskRow({ task }: { task: Task }) {
  const setDone = useAction('task.setDone');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        type="checkbox"
        aria-label={`Done: ${task.title}`}
        checked={task.completedAt !== null}
        disabled={setDone.isPending}
        onChange={(event) => setDone.mutate({ id: task.id, done: event.target.checked })}
      />
      <span className={task.completedAt ? 'text-ink-muted line-through' : ''}>{task.title}</span>
      {task.dueDate ? <span className="text-xs text-ink-muted">due {task.dueDate}</span> : null}
      <ActionError errors={[setDone.error]} />
    </li>
  );
}

export function EntryActions({ rawLog }: { rawLog: RawLog }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rawLog.content);
  const requeue = useAction('log.requeue');
  const editContent = useAction('log.editContent');
  const remove = useAction('log.delete');
  const busy = requeue.isPending || editContent.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-2">
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            editContent.mutate({ id: rawLog.id, content: text });
          }}
        >
          <textarea
            aria-label="Entry text"
            className={`${fieldClass} min-h-16`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
              disabled={busy || !text.trim() || text === rawLog.content}
            >
              Save and organize again
            </button>
            <QuietButton onClick={() => setEditing(false)}>Cancel</QuietButton>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <QuietButton disabled={busy} onClick={() => requeue.mutate({ id: rawLog.id })}>
            {rawLog.status === 'processed' ? 'Organize again' : 'Organize now'}
          </QuietButton>
          <QuietButton disabled={busy} onClick={() => setEditing(true)}>
            Edit text
          </QuietButton>
          <QuietButton disabled={busy} onClick={() => remove.mutate({ id: rawLog.id })}>
            Delete entry
          </QuietButton>
        </div>
      )}
      <ActionError errors={[requeue.error, editContent.error, remove.error]} />
    </div>
  );
}
