import {
  finishedDaysLate,
  PROGRESS_MAX,
  PROGRESS_MIN,
  type Task,
  taskState,
} from '@avchetan/db/sqlite';
import { formatTiming, moveDates } from '@avchetan/shared';
import { type ReactNode, useState } from 'react';
import { useToday } from '../queries/days';
import { useAction } from '../queries/organize';
import { useServices } from '../services-context';
import { ActionError, fieldClass, QuietButton } from './ui';
import { useUndo } from './undo-bar';

/** The checkbox: ticks done, unticks back to open. A cancelled task is unticked; ticking it is done. */
export function TaskCheckbox({ task }: { task: Task }) {
  const setDone = useAction('task.setDone');
  return (
    <>
      <input
        type="checkbox"
        aria-label={`Done: ${task.title}`}
        checked={task.completedAt !== null}
        disabled={setDone.isPending}
        onChange={(event) => setDone.mutate({ id: task.id, done: event.target.checked })}
      />
      {setDone.error ? <ActionError errors={[setDone.error]} /> : null}
    </>
  );
}

/** Struck through when done or cancelled. */
export const taskTitleClass = (task: Task) =>
  taskState(task) === 'open' ? '' : 'text-ink-muted line-through';

/** "Cancelled", "40% done", "2 days late", and the note on how it went. */
export function TaskStatus({ task }: { task: Task }) {
  const { timeZone } = useServices();
  const state = taskState(task);
  const parts: string[] = [];
  if (state === 'cancelled') parts.push('Cancelled');
  if (state === 'done') {
    const late = finishedDaysLate(task, timeZone.current());
    if (late !== null) parts.push(`Done ${formatTiming(late)}`);
  }
  if (state === 'open' && task.progressPct !== null) parts.push(`${task.progressPct}% done`);
  if (parts.length === 0 && !task.completionNote) return null;
  return (
    <span className="text-xs text-ink-muted">
      {parts.join(' · ')}
      {task.completionNote ? (
        <span className="italic">
          {parts.length > 0 ? ' · ' : ''}“{task.completionNote}”
        </span>
      ) : null}
    </span>
  );
}

type Mode = 'closed' | 'menu' | 'note' | 'progress';

/**
 * A task's *More* button and the actions it opens (product/tasks-routines-reminders.md §1): done
 * with a note, partly done, move, cancel, reopen and delete (with an undo message).
 */
export function useTaskMenu(task: Task) {
  const [mode, setMode] = useState<Mode>('closed');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(String(task.progressPct ?? 50));
  const today = useToday();
  const { actions } = useServices();
  const undo = useUndo();
  const finish = useAction('task.finish');
  const partly = useAction('task.partlyDone');
  const cancel = useAction('task.cancel');
  const reopen = useAction('task.setDone');
  const move = useAction('task.edit');
  const close = () => setMode('closed');
  const open = taskState(task) === 'open';
  const { tomorrow, nextWeek } = moveDates(today);

  const button = (
    <QuietButton
      label={`More actions: ${task.title}`}
      expanded={mode !== 'closed'}
      onClick={() => setMode(mode === 'closed' ? 'menu' : 'closed')}
    >
      More
    </QuietButton>
  );

  const remove = () => {
    close();
    undo.later({
      key: task.id,
      message: 'Task deleted.',
      commit: () => actions.run('task.delete', { id: task.id }),
    });
  };
  const moveTo = (dueDate: string) => move.mutate({ id: task.id, dueDate }, { onSuccess: close });

  let panel: ReactNode = null;
  if (mode === 'menu') {
    panel = open ? (
      <div className="flex flex-wrap items-center gap-2">
        <QuietButton onClick={() => setMode('note')}>Done with a note…</QuietButton>
        <QuietButton onClick={() => setMode('progress')}>Partly done…</QuietButton>
        <span className="text-xs text-ink-muted">Move:</span>
        <QuietButton disabled={move.isPending} onClick={() => moveTo(tomorrow)}>
          Tomorrow
        </QuietButton>
        {nextWeek !== tomorrow ? (
          <QuietButton disabled={move.isPending} onClick={() => moveTo(nextWeek)}>
            Next week
          </QuietButton>
        ) : null}
        <input
          type="date"
          aria-label="Pick a date"
          className={`${fieldClass} text-xs`}
          min={today}
          onChange={(event) => {
            if (event.target.value) moveTo(event.target.value);
          }}
        />
        <QuietButton
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ id: task.id }, { onSuccess: close })}
        >
          Cancel task
        </QuietButton>
        <QuietButton onClick={remove}>Delete</QuietButton>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <QuietButton
          disabled={reopen.isPending}
          onClick={() => reopen.mutate({ id: task.id, done: false }, { onSuccess: close })}
        >
          Reopen
        </QuietButton>
        <QuietButton onClick={remove}>Delete</QuietButton>
      </div>
    );
  } else if (mode === 'note') {
    panel = (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          finish.mutate({ id: task.id, note: note.trim() || null }, { onSuccess: close });
        }}
      >
        <input
          aria-label="How did it go?"
          placeholder="How did it go? (optional)"
          className={`${fieldClass} min-w-0 flex-1`}
          value={note}
          // biome-ignore lint/a11y/noAutofocus: the user just asked to write the note
          autoFocus
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        />
        <button
          type="submit"
          disabled={finish.isPending}
          className="rounded-lg bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          Mark done
        </button>
        <QuietButton onClick={() => setMode('menu')}>Back</QuietButton>
      </form>
    );
  } else if (mode === 'progress') {
    const pct = Number(progress);
    const valid = Number.isInteger(pct) && pct >= PROGRESS_MIN && pct <= PROGRESS_MAX;
    panel = (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) partly.mutate({ id: task.id, progressPct: pct }, { onSuccess: close });
        }}
      >
        <label className="flex items-center gap-2 text-xs">
          How much is done?
          <input
            type="number"
            min={PROGRESS_MIN}
            max={PROGRESS_MAX}
            className={`${fieldClass} w-16`}
            value={progress}
            // biome-ignore lint/a11y/noAutofocus: the user just asked to set the percentage
            autoFocus
            onChange={(event) => setProgress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          />
          %
        </label>
        <button
          type="submit"
          disabled={!valid || partly.isPending}
          className="rounded-lg bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          Save
        </button>
        <QuietButton onClick={() => setMode('menu')}>Back</QuietButton>
        {valid ? null : (
          <span className="text-xs text-danger">
            A whole number from {PROGRESS_MIN} to {PROGRESS_MAX}.
          </span>
        )}
      </form>
    );
  }

  const errors = (
    <ActionError errors={[finish.error, partly.error, cancel.error, reopen.error, move.error]} />
  );
  return {
    button,
    panel: panel ? (
      <div className="flex flex-col gap-1">
        {panel}
        {errors}
      </div>
    ) : (
      errors
    ),
    hidden: undo.isHidden(task.id),
  };
}
