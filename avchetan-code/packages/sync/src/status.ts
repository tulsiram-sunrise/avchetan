import type { ClientStore } from '@avchetan/db/sqlite';
import { z } from 'zod';

const SYNC_STATES = [
  'not_configured',
  'offline',
  'syncing',
  'synced',
  'unauthorized',
  'server_unreachable',
  'failed',
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const syncStatusSchema = z.object({
  state: z.enum(SYNC_STATES),
  /** Set when the server refused rows because this device's clock is wrong. */
  clockSkew: z.boolean(),
  /** Changes the server keeps refusing, shown as a sync issue. */
  stuck: z.int(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const INITIAL_STATUS: SyncStatus = { state: 'not_configured', clockSkew: false, stuck: 0 };

/** The latest result, kept so every screen and window can read it. */
export async function loadSyncStatus(store: ClientStore): Promise<SyncStatus> {
  const stored = await store.sync.getState('status');
  if (!stored) return INITIAL_STATUS;
  const parsed = syncStatusSchema.safeParse(JSON.parse(stored));
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
  unauthorized: { text: 'The server refused this sync token.', helpCode: 'unauthorized' },
  server_unreachable: { text: "Can't reach the server.", helpCode: 'server_unreachable' },
  failed: { text: "Sync didn't finish. It will try again.", helpCode: 'server_unreachable' },
};

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
  return STATE_TEXT[status.state];
}
