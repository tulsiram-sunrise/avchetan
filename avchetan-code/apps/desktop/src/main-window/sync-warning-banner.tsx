import { syncWarningText } from '@avchetan/sync';
import { HelpLink } from '../help-link';
import { useSyncNow, useSyncWarning } from '../queries/sync';
import { useServices } from '../services-context';
import { QuietButton } from './ui';

/** The dock syncs; this is how long the banner gives it before looking again. */
const RECHECK_AFTER_SYNC_MS = 5_000;

/**
 * On Days when entries have waited a day for a hub that can't be reached
 * (docs/product/finding-and-using-data.md#5-hub-unreachable-warning). Clears after a sync.
 */
export function SyncWarningBanner() {
  const { timeZone } = useServices();
  const warning = useSyncWarning();
  const syncNow = useSyncNow();
  if (!warning.data) return null;

  return (
    <div role="alert" className="mb-4 flex flex-col gap-1 rounded-lg bg-warn/15 px-4 py-3 text-sm">
      <p className="font-medium">{syncWarningText(warning.data, timeZone.current())}</p>
      <p className="text-ink-muted">
        {warning.data.fix} <HelpLink code={warning.data.helpCode} />
      </p>
      <div>
        <QuietButton
          disabled={syncNow.isPending}
          onClick={() =>
            syncNow.mutate(undefined, {
              onSuccess: () => setTimeout(() => void warning.refetch(), RECHECK_AFTER_SYNC_MS),
            })
          }
        >
          Sync now
        </QuietButton>
      </div>
    </div>
  );
}
