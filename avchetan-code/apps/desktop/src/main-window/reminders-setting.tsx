import { toAppError } from '@avchetan/shared';
import { HelpLink } from '../help-link';
import { useRingHere, useSetRingHere } from '../queries/settings';

/** *Ring for reminders on this device* (product/tasks-routines-reminders.md §7); this PC only. */
export function RemindersSetting() {
  const ring = useRingHere();
  const change = useSetRingHere();
  const checked = change.isPending ? change.variables : (ring.data ?? false);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Reminders</h2>
      <p className="text-sm text-ink-muted">
        A task's reminder rings on each device set to ring. Your phone rings unless you turned it
        off there; this PC shows a Windows notification while Avchetan is running.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={!ring.isSuccess}
          onChange={(event) => change.mutate(event.target.checked)}
        />
        Ring for reminders on this device
      </label>
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </section>
  );
}
