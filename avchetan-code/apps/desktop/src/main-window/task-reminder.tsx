import { describeReminder, reminderDraft, reminderInstant } from '@avchetan/core';
import { type Task, taskState } from '@avchetan/db/sqlite';
import { isValidLocalDate, isValidLocalTime } from '@avchetan/shared';
import { useState } from 'react';
import { useToday } from '../queries/days';
import { useAction } from '../queries/organize';
import { useRingHere } from '../queries/settings';
import { useServices } from '../services-context';
import { ActionError, fieldClass, QuietButton } from './ui';

/** "⏰ Today 16:00" for an open task with a reminder (product/tasks-routines-reminders.md §7). */
export function useReminderText(task: Task): string | null {
  const today = useToday();
  const { timeZone } = useServices();
  if (!task.remindAt || taskState(task) !== 'open') return null;
  return `⏰ ${describeReminder(task.remindAt, today, timeZone.current())}`;
}

/** Remind me: a day and a time in this PC's time zone, saved as the instant. */
export function ReminderPanel(props: { task: Task; onDone: () => void; onBack: () => void }) {
  const { task, onDone, onBack } = props;
  const today = useToday();
  const { store, timeZone } = useServices();
  const ring = useRingHere();
  const set = useAction('task.setReminder');
  const [draft, setDraft] = useState(() => reminderDraft(task, today, timeZone.current()));

  const valid = isValidLocalDate(draft.date) && isValidLocalTime(draft.time);
  const at = valid ? reminderInstant(draft.date, draft.time, timeZone.current()) : null;
  const past = at !== null && at <= store.clock.now();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (at && !past) set.mutate({ id: task.id, remindAt: at }, { onSuccess: onDone });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          Day
          <input
            type="date"
            className={`${fieldClass} text-xs`}
            min={today}
            value={draft.date}
            onChange={(event) => setDraft({ ...draft, date: event.target.value as never })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          Time
          <input
            type="time"
            className={`${fieldClass} text-xs`}
            value={draft.time}
            onChange={(event) => setDraft({ ...draft, time: event.target.value as never })}
          />
        </label>
      </div>
      {past ? <p className="text-xs text-danger">That time has passed.</p> : null}
      {ring.data === false ? (
        <p className="text-xs text-ink-muted">
          This PC doesn't ring for reminders; your phone does unless you turned it off there. To
          ring here too, turn it on in Settings → General → Reminders.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={at === null || past || set.isPending}
          className="rounded-lg bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          Save reminder
        </button>
        {task.remindAt ? (
          <QuietButton
            disabled={set.isPending}
            onClick={() => set.mutate({ id: task.id, remindAt: null }, { onSuccess: onDone })}
          >
            No reminder
          </QuietButton>
        ) : null}
        <QuietButton onClick={onBack}>Back</QuietButton>
      </div>
      <ActionError errors={[set.error]} />
    </form>
  );
}
