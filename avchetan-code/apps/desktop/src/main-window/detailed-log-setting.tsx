import { formatTime } from '@avchetan/shared';
import { useDetailedLogUntil, useSetDetailedLog } from '../queries/settings';
import { ActionError, QuietButton } from './ui';

/**
 * *Detailed log for 1 hour*: requests, sync steps and each entry organized (still never what you
 * wrote), for this PC and its built-in hub, ending by itself.
 */
export function DetailedLogSetting() {
  const until = useDetailedLogUntil();
  const change = useSetDetailedLog();
  const on = until.data != null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">
        {on
          ? `The log is detailed until ${formatTime(until.data ?? '')}: each request, sync step and entry organized, still never what you wrote.`
          : 'If you are asked for a detailed log, turn it on, do what went wrong again, then attach the log. It turns itself off after an hour.'}
      </p>
      <div className="flex gap-2">
        <QuietButton
          disabled={!until.isSuccess || change.isPending}
          onClick={() => change.mutate(!on)}
        >
          {on ? 'Turn off the detailed log' : 'Detailed log for 1 hour'}
        </QuietButton>
      </div>
      <ActionError errors={[change.error]} />
    </div>
  );
}
