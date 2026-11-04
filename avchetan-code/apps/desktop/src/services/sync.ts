import { loadExtractionMode, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createSyncEngine, type SyncEngine } from '@avchetan/sync';
import type { Platform } from '../platform';
import { announce } from './extraction';

/** Wires the engine to this platform. Only the dock starts it, as it never closes. */
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
    // Read every cycle: a PC set to let its hub organize (services/hub.ts) tells the hub so.
    device: async () => ({
      name: 'Windows PC',
      platform: 'windows',
      extractionMode: await loadExtractionMode(store),
    }),
    onSynced: () => {
      void announce(store, platform);
      void extraction.wake();
    },
  });
}
