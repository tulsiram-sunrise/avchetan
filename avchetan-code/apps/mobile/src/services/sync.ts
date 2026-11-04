import { loadExtractionMode, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createSyncEngine, type SyncEngine } from '@avchetan/sync';
import type { Platform } from '../platform';
import { refreshAll } from '../query-client';

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
    device: async () => ({
      name: 'Android phone',
      platform: 'android',
      extractionMode: await loadExtractionMode(store),
    }),
    onSynced: () => {
      refreshAll();
      void extraction.wake();
    },
  });
}
