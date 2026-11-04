import { BACKUPS_KEPT } from '@avchetan/db/sqlite';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backUpNow, exportEverything } from '../services/data';
import { useServices } from '../services-context';
import { ActionError, QuietButton } from './ui';

const BACKUPS_KEY = ['native', 'backups'] as const;

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Export everything, and the daily backups the dock makes (docs/user-guide/backup-and-restore.md). */
export function DataSetting() {
  const services = useServices();
  const { files } = services.platform;
  const queryClient = useQueryClient();
  const backups = useQuery({ queryKey: BACKUPS_KEY, queryFn: () => files.listBackups() });
  const backup = useMutation({
    mutationFn: () => backUpNow(services),
    onSuccess: (list) => queryClient.setQueryData(BACKUPS_KEY, list),
  });
  const exported = useMutation({ mutationFn: () => exportEverything(services) });
  const openFolder = useMutation({ mutationFn: files.openFolder });
  const newest = backups.data?.files[0];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Your data</h2>
      <p className="text-sm text-ink-muted">
        Export saves every entry and everything organized from it as JSON, plus a CSV per table that
        opens in a spreadsheet. Keys and settings are not included.
      </p>
      <div className="flex gap-2">
        <QuietButton disabled={exported.isPending} onClick={() => exported.mutate()}>
          {exported.isPending ? 'Exporting…' : 'Export everything'}
        </QuietButton>
        <QuietButton onClick={() => openFolder.mutate('exports')}>Open exports folder</QuietButton>
      </div>
      {exported.data ? (
        <p role="status" className="break-all text-sm text-ink-muted">
          Saved to {exported.data}
        </p>
      ) : null}
      <p className="pt-2 text-sm text-ink-muted">
        A copy of this PC's database is made every day; the last {BACKUPS_KEPT} are kept.{' '}
        {newest
          ? `Latest: ${newest.name} (${megabytes(newest.sizeBytes)}).`
          : backups.isSuccess
            ? 'No backup yet.'
            : null}
      </p>
      <div className="flex gap-2">
        <QuietButton disabled={backup.isPending} onClick={() => backup.mutate()}>
          {backup.isPending ? 'Backing up…' : 'Back up now'}
        </QuietButton>
        <QuietButton onClick={() => openFolder.mutate('backups')}>Open backups folder</QuietButton>
      </div>
      <ActionError errors={[exported.error, backup.error, backups.error, openFolder.error]} />
    </section>
  );
}
