import type { ClientStore } from '@avchetan/db/sqlite';
import { formatLocalDate, localDate, type TimeZone } from '@avchetan/shared';
import { loadServerUrls } from './config';
import { describeSync, loadSyncStatus, type SyncStatus } from './status';

/** How long entries may wait without a sync before Days warns (finding-and-using-data.md §5). */
export const SYNC_WARNING_AFTER_MS = 24 * 60 * 60_000;

/** What usually fixes it when the hub just can't be reached. */
export const SYNC_WARNING_FIX =
  'Check that the PC with your hub is on and Avchetan is running there, and that this device is on the same Wi-Fi or on Tailscale.';

/** Last sync results that name their own fix, so the banner doesn't send the user to the Wi-Fi. */
const OWN_FIX = new Set(['unauthorized', 'clock_skew', 'sync_issue']);

export type SyncWarning = {
  /** The last successful sync, or null when this device never synced. */
  lastSyncedAt: string | null;
  /** Entries waiting to be sent. */
  waiting: number;
  /** What to do about it, from the last sync result. */
  fix: string;
  /** The troubleshooting section for it. */
  helpCode: string;
};

export type SyncWarningInput = {
  /** This device syncs with a hub or server; Standalone devices never warn. */
  configured: boolean;
  lastSyncedAt: string | null;
  waiting: number;
  /** When the oldest waiting entry was queued. */
  oldestWaitingAt: string | null;
  /** The last sync's result (status.ts). */
  status: SyncStatus;
  nowMs: number;
};

/**
 * The warning on Days when a device can't reach its hub: entries have waited 24 hours and no
 * sync worked in that time. Both must hold, so a phone left unused for days doesn't warn the
 * moment a new entry is added, before its first sync could even try. Clears after a sync.
 * A refused token, a wrong clock or refused changes say so; anything else is "can't reach".
 */
export function syncWarning(input: SyncWarningInput): SyncWarning | null {
  const { configured, lastSyncedAt, waiting, oldestWaitingAt, nowMs } = input;
  if (!configured || waiting === 0 || !oldestWaitingAt) return null;
  const longAgo = (at: string) => nowMs - Date.parse(at) >= SYNC_WARNING_AFTER_MS;
  if (!longAgo(oldestWaitingAt)) return null;
  if (lastSyncedAt && !longAgo(lastSyncedAt)) return null;
  const summary = describeSync(input.status);
  if (summary.helpCode && OWN_FIX.has(summary.helpCode)) {
    return { lastSyncedAt, waiting, fix: summary.text, helpCode: summary.helpCode };
  }
  return { lastSyncedAt, waiting, fix: SYNC_WARNING_FIX, helpCode: 'server_unreachable' };
}

/** Reads what `syncWarning` needs from this device. `nowMs` is the wall clock. */
export async function loadSyncWarning(
  store: ClientStore,
  nowMs: number = Date.now(),
): Promise<SyncWarning | null> {
  const [urls, lastSyncedAt, waiting, status] = await Promise.all([
    loadServerUrls(store),
    store.sync.getState('last_pull_at'),
    store.sync.waitingEntries(),
    loadSyncStatus(store),
  ]);
  return syncWarning({
    configured: urls.length > 0,
    lastSyncedAt: lastSyncedAt || null,
    waiting: waiting.count,
    oldestWaitingAt: waiting.oldestAt,
    status,
    nowMs,
  });
}

/** The banner's first line: "Not synced with your hub since Mon, 9 Nov — 12 entries waiting." */
export function syncWarningText(
  warning: Pick<SyncWarning, 'lastSyncedAt' | 'waiting'>,
  timeZone: TimeZone,
): string {
  const since = warning.lastSyncedAt
    ? `since ${formatLocalDate(localDate(warning.lastSyncedAt, timeZone), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })}`
    : 'yet';
  const waiting = warning.waiting === 1 ? '1 entry' : `${warning.waiting} entries`;
  return `Not synced with your hub ${since} — ${waiting} waiting.`;
}
