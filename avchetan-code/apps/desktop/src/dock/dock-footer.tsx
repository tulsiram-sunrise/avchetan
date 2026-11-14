import { createLogger, formatAgo } from '@avchetan/shared';
import type { HubDot } from '@avchetan/sync';
import type { ReactNode } from 'react';
import type { MainView } from '../native/events';
import { useToday } from '../queries/days';
import { usePendingCount } from '../queries/raw-logs';
import { useDockStatus } from '../queries/sync';
import { commandDeps } from '../services/commands';
import { useServices } from '../services-context';
import { useOnline } from '../use-online';
import { undoStack } from './use-command';

const log = createLogger('dock');

const DOT_CLASS: Record<HubDot, string> = {
  synced: 'bg-ok',
  trying: 'bg-warn',
  problem: 'bg-danger',
};

const DOT_WORD: Record<HubDot, string> = {
  synced: 'Synced',
  trying: 'Syncing',
  problem: 'Not synced',
};

/**
 * The status line (docs/product/capture-box-redesign.md#7-status-line), from local data: tasks due
 * today, entries waiting to be organized or sent, and the hub. Each item opens its page.
 */
export function DockFooter() {
  const services = useServices();
  const { platform } = services;
  const online = useOnline();
  const today = useToday();
  const pending = usePendingCount().data ?? 0;
  const status = useDockStatus(today).data;

  const open = (view: MainView) =>
    platform.shell.openMain(view).catch(() => log.warn('could not open the main window'));
  const openHub = () =>
    commandDeps(services, undoStack)
      .openSettings('hub')
      .catch(() => log.warn('could not open hub settings'));

  const dot = status?.dot ?? null;
  const hubTitle = status
    ? `${status.statusText}${status.lastSyncedAt ? ` Last synced ${formatAgo(status.lastSyncedAt, Date.now())}.` : ''}`
    : undefined;

  return (
    <footer className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-line pt-2 text-xs text-ink-muted">
      {dot ? (
        <Item onClick={openHub} title={hubTitle}>
          <span aria-hidden className={`size-2 rounded-full ${DOT_CLASS[dot]}`} />
          {DOT_WORD[dot]}
        </Item>
      ) : (
        <span className="flex items-center gap-1.5 px-1.5">
          <span
            aria-hidden
            className={`size-2 rounded-full ${online ? 'bg-ok' : 'bg-ink-muted'}`}
          />
          {online ? 'Online' : 'Offline, saved on this PC'}
        </span>
      )}
      {status && status.dueToday > 0 ? (
        <Item onClick={() => open('tasks')}>{status.dueToday} due today</Item>
      ) : null}
      {pending > 0 ? <Item onClick={() => open('timeline')}>{pending} to organize</Item> : null}
      {dot && status && status.waitingToSend > 0 ? (
        <Item onClick={openHub}>{status.waitingToSend} to send</Item>
      ) : null}
      <span className="flex-1" />
      <Item onClick={() => open('timeline')}>Open Avchetan</Item>
    </footer>
  );
}

function Item(props: { onClick: () => void; title?: string | undefined; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-ink"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
