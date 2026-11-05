import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { HubStatus } from '../native/hub';
import { useServices } from '../services-context';
import { ActionError, fieldClass, QuietButton } from './ui';

const BACKUPS_KEY = ['native', 'hub-backups'] as const;

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** The hub's daily snapshots (docs/user-guide/backup-and-restore.md). */
export function HubBackups(props: { onRestored: (status: HubStatus) => void }) {
  const { hub } = useServices().platform;
  const queryClient = useQueryClient();
  const backups = useQuery({ queryKey: BACKUPS_KEY, queryFn: () => hub.listBackups() });
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState(false);
  const openFolder = useMutation({ mutationFn: hub.openFolder });
  const restore = useMutation({
    mutationFn: (name: string) => hub.restore(name),
    onSuccess: (status) => {
      props.onRestored(status);
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
    },
  });

  const list = backups.data ?? [];
  const selected = chosen || list[0]?.name || '';

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink-muted">
        Hub backups{backups.isSuccess ? ` (${list.length})` : ''}
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-ink-muted">
          The hub saves a copy of its data every day and keeps the last 7.{' '}
          {list[0] ? `Latest: ${list[0].name} (${megabytes(list[0].sizeBytes)}).` : 'None yet.'}
        </p>
        {list.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              aria-label="Backup to restore"
              className={fieldClass}
              value={selected}
              onChange={(event) => setChosen(event.target.value)}
            >
              {list.map((backup) => (
                <option key={backup.name} value={backup.name}>
                  {backup.name}
                </option>
              ))}
            </select>
            <QuietButton disabled={restore.isPending} onClick={() => setConfirming(true)}>
              {restore.isPending ? 'Restoring…' : 'Restore…'}
            </QuietButton>
          </div>
        ) : null}
        {confirming ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p>
              The hub goes back to {selected}. Its current data is kept beside it, renamed. Your
              devices then send it everything they hold, so entries made since come back too.
            </p>
            <div className="flex gap-2">
              <QuietButton
                onClick={() => {
                  setConfirming(false);
                  restore.mutate(selected);
                }}
              >
                Restore {selected}
              </QuietButton>
              <QuietButton onClick={() => setConfirming(false)}>Cancel</QuietButton>
            </div>
          </div>
        ) : null}
        {restore.isSuccess ? (
          <p role="status" className="text-ink-muted">
            Restored. Your devices are sending it their entries again.
          </p>
        ) : null}
        <div className="flex gap-2">
          <QuietButton onClick={() => openFolder.mutate('backups')}>
            Open backups folder
          </QuietButton>
          <QuietButton onClick={() => openFolder.mutate('data')}>Open hub folder</QuietButton>
        </div>
        <ActionError errors={[restore.error, openFolder.error, backups.error]} />
      </div>
    </details>
  );
}
