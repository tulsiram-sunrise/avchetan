import { loadBriefSettings, loadExtractionMode, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { systemTimeZone } from '@avchetan/shared';
import { createSyncEngine, type SyncEngine } from '@avchetan/sync';
import type { Platform } from '../platform';
import { refreshAll } from '../query-client';
import { usePullProgress } from '../stores/pull-progress';
import { scheduleChoreEvening } from './chore-evening';

/**
 * Pulled changes per page, each applied in one transaction. Smaller than the server's 500, so the
 * screen's own reads wait less between pages of a long first download.
 */
const PULL_PAGE_SIZE = 200;

/** Wires the engine to this platform. */
export function createSyncService(
  store: ClientStore,
  platform: Platform,
  extraction: PendingProcessor,
): SyncEngine {
  const { fetch, secrets, network, scheduler } = platform;
  return createSyncEngine({
    store,
    fetch,
    secrets,
    network,
    scheduler,
    // Read each cycle, so switching who organizes entries tells the hub at the next sync.
    // The zone and brief time tell the hub when to make a brief no device made.
    device: async () => {
      const brief = await loadBriefSettings(store);
      return {
        name: 'Android phone',
        platform: 'android',
        extractionMode: await loadExtractionMode(store),
        timeZone: systemTimeZone(),
        briefTime: brief.enabled ? brief.time : null,
      };
    },
    onSynced: () => {
      refreshAll();
      // Chores ticked on another device take back this evening's notification.
      void scheduleChoreEvening(store);
      void extraction.wake();
    },
    onPullProgress: (progress) => usePullProgress.getState().setProgress(progress),
    pullPageSize: PULL_PAGE_SIZE,
  });
}
