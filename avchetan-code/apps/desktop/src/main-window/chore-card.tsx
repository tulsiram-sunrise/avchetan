import { useAction } from '../queries/organize';
import { useDayChores } from '../queries/routines';
import { ActionError, panelClass } from './ui';

/**
 * The day's chores in one card, each with a tick (docs/product/tasks-routines-reminders.md §4).
 * Nothing shows on a day without chores; days are only made from today on.
 */
export function ChoreCard({ day }: { day: string }) {
  const chores = useDayChores(day);
  const setDone = useAction('routineDay.setDone');
  const rows = chores.data ?? [];
  if (rows.length === 0) return null;
  const doneCount = rows.filter((row) => row.day.status === 'done').length;
  return (
    <section aria-label="Chores">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Chores · {doneCount} of {rows.length}
      </h2>
      <ul className={`${panelClass} gap-0 [&>li]:px-4 [&>li]:py-2`}>
        {rows.map(({ routine, day: routineDay }) => {
          const done = routineDay.status === 'done';
          const skipped = routineDay.status === 'skipped';
          return (
            <li key={routineDay.id}>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={setDone.isPending}
                  onChange={(event) =>
                    setDone.mutate({ routineId: routine.id, day, done: event.target.checked })
                  }
                />
                <span className={done || skipped ? 'text-ink-muted line-through' : ''}>
                  {routine.title}
                  {skipped ? ' (skipped)' : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {setDone.error ? <ActionError errors={[setDone.error]} /> : null}
    </section>
  );
}
