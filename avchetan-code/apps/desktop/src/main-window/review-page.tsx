import type { RawLog } from '@avchetan/db/sqlite';
import { formatDay, formatTime } from '@avchetan/shared';
import { StatusBadge } from '../dock/status-badge';
import { useLogsToReview } from '../queries/organize';
import { EntryActions } from './timeline-items';
import { panelClass } from './ui';

function LogLine({ rawLog }: { rawLog: RawLog }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{rawLog.content}</p>
        <StatusBadge status={rawLog.status} />
      </div>
      <p className="text-xs text-ink-muted">
        {formatDay(rawLog.capturedAt)}, {formatTime(rawLog.capturedAt)}
        {rawLog.lastError ? ` · ${rawLog.lastError}` : ''}
      </p>
      <EntryActions rawLog={rawLog} />
    </li>
  );
}

function Group(props: { title: string; hint: string; logs: readonly RawLog[] }) {
  if (props.logs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-medium">
          {props.title} ({props.logs.length})
        </h2>
        <p className="text-sm text-ink-muted">{props.hint}</p>
      </div>
      <ul className={panelClass}>
        {props.logs.map((rawLog) => (
          <LogLine key={rawLog.id} rawLog={rawLog} />
        ))}
      </ul>
    </section>
  );
}

/** Entries that weren't organized, and what can be done about each. */
export function ReviewPage() {
  const logs = useLogsToReview();
  const of = (status: RawLog['status']) => (logs.data ?? []).filter((l) => l.status === status);

  if (logs.isSuccess && logs.data.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing to review. Every entry is organized.</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Group
        title="Couldn't be organized"
        hint="Your text is safe. Try again, or reword the entry."
        logs={of('error')}
      />
      <Group
        title="Waiting"
        hint="These are organized automatically. Check Settings if they never move."
        logs={of('pending_llm')}
      />
      <Group
        title="Saved only"
        hint="Nothing in these looked worth organizing, or they're private and no local model is set."
        logs={of('skipped')}
      />
    </div>
  );
}
