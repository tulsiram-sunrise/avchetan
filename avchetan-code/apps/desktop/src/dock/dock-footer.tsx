import { createLogger } from '@avchetan/shared';
import { usePendingCount } from '../queries/raw-logs';
import { useServices } from '../services-context';
import { useOnline } from '../use-online';

const log = createLogger('dock');

export function DockFooter() {
  const { platform } = useServices();
  const online = useOnline();
  const pending = usePendingCount();

  return (
    <footer className="flex items-center gap-3 border-t border-line px-1 pt-2 text-xs text-ink-muted">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={`size-2 rounded-full ${online ? 'bg-ok' : 'bg-ink-muted'}`} />
        {online ? 'Online' : 'Offline — entries are saved on this PC'}
      </span>
      <span>{pending.data ?? 0} waiting to be organized</span>
      <button
        type="button"
        className="ml-auto rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-ink"
        onClick={() =>
          platform.shell.openMain().catch(() => log.warn('could not open main window'))
        }
      >
        Open Avchetan
      </button>
    </footer>
  );
}
