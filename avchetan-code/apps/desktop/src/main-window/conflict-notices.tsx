import { loadConflictNotices } from '@avchetan/core';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../queries/organize';
import { useServices } from '../services-context';
import { ActionError, QuietButton } from './ui';

/**
 * *Changed on two devices* (ADR-0034): a hand edit made here lost to another device's. Each
 * notice shows both versions; Keep this one writes this PC's again, Keep the other forgets it.
 */
export function ConflictNotices() {
  const { store } = useServices();
  // Keyed by `tasks`, so a sync or an edit (`logs:changed`) looks again.
  const notices = useQuery({
    queryKey: ['tasks', 'conflicts'],
    queryFn: () => loadConflictNotices(store),
  });
  const keepMine = useAction('conflict.keepMine');
  const keepTheirs = useAction('conflict.keepTheirs');
  const busy = keepMine.isPending || keepTheirs.isPending;
  if (!notices.data?.length) return null;

  return (
    <section aria-label="Changed on two devices" className="mb-4 flex flex-col gap-2">
      {notices.data.map((notice) => (
        <div
          key={`${notice.table}:${notice.id}`}
          className="flex flex-col gap-2 rounded-lg bg-warn/15 px-4 py-3 text-sm"
        >
          <p className="font-medium">
            Changed on two devices: {notice.kind.toLowerCase()} “{notice.title}”
          </p>
          <table className="text-left">
            <thead className="text-ink-muted">
              <tr>
                <th className="pr-4 font-normal" scope="col">
                  <span className="sr-only">Field</span>
                </th>
                <th className="pr-4 font-normal" scope="col">
                  On this PC
                </th>
                <th className="font-normal" scope="col">
                  Kept (from the other device)
                </th>
              </tr>
            </thead>
            <tbody>
              {notice.lines.map((line) => (
                <tr key={line.label}>
                  <th className="pr-4 font-normal text-ink-muted" scope="row">
                    {line.label}
                  </th>
                  <td className="pr-4">{line.mine}</td>
                  <td>{line.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <QuietButton
              disabled={busy}
              onClick={() => keepMine.mutate({ table: notice.table, id: notice.id })}
            >
              Keep this one
            </QuietButton>
            <QuietButton
              disabled={busy}
              onClick={() => keepTheirs.mutate({ table: notice.table, id: notice.id })}
            >
              Keep the other
            </QuietButton>
          </div>
        </div>
      ))}
      <ActionError errors={[keepMine.error, keepTheirs.error]} />
    </section>
  );
}
