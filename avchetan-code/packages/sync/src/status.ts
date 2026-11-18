import type { ClientStore } from '@avchetan/db/sqlite';
import { createLogger, describeError, errorMessage } from '@avchetan/shared';
import { z } from 'zod';

const SYNC_STATES = [
  'not_configured',
  'offline',
  'syncing',
  'synced',
  'unauthorized',
  'server_unreachable',
  /** A different server answered at the saved addresses; nothing was sent to it. */
  'wrong_server',
  'failed',
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const syncStatusSchema = z.object({
  state: z.enum(SYNC_STATES),
  /** Set when the server refused rows because this device's clock is wrong. */
  clockSkew: z.boolean(),
  /** Changes the server keeps refusing, shown as a sync issue. */
  stuck: z.int(),
  /** Rows from another device this app can't read yet, set aside (ADR-0032). */
  setAside: z.int().default(0),
  /** Why the last sync failed, so the right guide section is linked. Null once one succeeds. */
  errorCode: z.string().max(64).nullable().default(null),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const INITIAL_STATUS: SyncStatus = {
  state: 'not_configured',
  clockSkew: false,
  stuck: 0,
  setAside: 0,
  errorCode: null,
};

const log = createLogger('sync');

/** The latest result, kept so every screen and window can read it. */
export async function loadSyncStatus(store: ClientStore): Promise<SyncStatus> {
  const stored = await store.sync.getState('status');
  if (!stored) return INITIAL_STATUS;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    // A status cut short (the app closed while writing it) reads as no status yet.
    log.warn('saved sync status is not JSON');
    return INITIAL_STATUS;
  }
  const parsed = syncStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : INITIAL_STATUS;
}

export type SyncSummary = {
  text: string;
  /** A section of the troubleshooting guide, when the user has something to fix. */
  helpCode: string | null;
};

const STATE_TEXT: Record<SyncState, SyncSummary> = {
  not_configured: { text: 'Not connected to a server.', helpCode: null },
  offline: { text: 'Offline. Changes will sync when you reconnect.', helpCode: null },
  syncing: { text: 'Syncing…', helpCode: null },
  synced: { text: 'Up to date.', helpCode: null },
  unauthorized: { text: `${errorMessage('unauthorized')}.`, helpCode: 'unauthorized' },
  server_unreachable: {
    text: `${errorMessage('server_unreachable')}.`,
    helpCode: 'server_unreachable',
  },
  wrong_server: {
    text: 'A different server answered at this address. Pair again.',
    helpCode: 'wrong_server',
  },
  failed: { text: "Sync didn't finish. It will try again.", helpCode: 'server_unreachable' },
};

/** A failed sync, with what went wrong when the code is known. */
function describeFailure(errorCode: string | null): SyncSummary {
  if (!errorCode) return STATE_TEXT.failed;
  const { message, section } = describeError({ code: errorCode, message: '' });
  return {
    text: message ? `Sync didn't finish: ${message}. It will try again.` : STATE_TEXT.failed.text,
    helpCode: section,
  };
}

/** What to tell the user. A problem they can fix comes before a state that resolves itself. */
export function describeSync(status: SyncStatus): SyncSummary {
  if (status.clockSkew) {
    return {
      text: "This device's clock is wrong, so some changes can't sync.",
      helpCode: 'clock_skew',
    };
  }
  if (status.stuck > 0) {
    return { text: `${status.stuck} changes keep failing to sync.`, helpCode: 'sync_issue' };
  }
  if (status.setAside > 0) {
    return {
      text: `${status.setAside} ${status.setAside === 1 ? 'change' : 'changes'} from another device can’t be read here. Update Avchetan on this device.`,
      helpCode: 'sync_set_aside',
    };
  }
  if (status.state === 'failed') return describeFailure(status.errorCode);
  return STATE_TEXT[status.state];
}

/** The capture box's hub dot (capture-box-redesign.md §7); null with no server set up. */
export type HubDot = 'synced' | 'trying' | 'problem';

export function hubDot(status: SyncStatus): HubDot | null {
  if (status.state === 'not_configured') return null;
  // Something the user has to fix comes first, as in describeSync.
  if (status.clockSkew || status.stuck > 0 || status.setAside > 0) return 'problem';
  if (status.state === 'synced') return 'synced';
  if (status.state === 'syncing' || status.state === 'offline') return 'trying';
  return 'problem';
}
