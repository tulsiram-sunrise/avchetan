import type { PendingProcessor } from '@avchetan/core';
import { type ClientStore, openClientStore } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import type { SyncEngine } from '@avchetan/sync';
import { tauriActionBus } from './native/action-bus';
import type { Platform } from './platform';
import { type ActionClient, createActionClient } from './services/actions';
import { type CaptureService, createCaptureService } from './services/capture';
import { createExtractionService } from './services/extraction';
import { createSyncService } from './services/sync';
import { createTimeZoneCache, type TimeZoneCache } from './services/time-zone';

const log = createLogger('app');

export type AppServices = {
  platform: Platform;
  store: ClientStore;
  capture: CaptureService;
  extraction: PendingProcessor;
  sync: SyncEngine;
  actions: ActionClient;
  timeZone: TimeZoneCache;
};

/** Wires the packages for one window: native database → client store → services. */
export async function openAppServices(platform: Platform): Promise<AppServices> {
  const started = performance.now();
  await platform.openDatabase();
  const store = await openClientStore({ executor: platform.sqlite });
  log.info('store ready', { durationMs: Math.round(performance.now() - started) });
  const timeZone = createTimeZoneCache(store);
  await timeZone.refresh();
  // Each needs the other: organizing queues a sync, and a sync may bring entries to organize.
  const extraction = createExtractionService(store, platform, () => sync.schedule());
  const sync = createSyncService(store, platform, extraction);
  return {
    platform,
    store,
    timeZone,
    actions: createActionClient(tauriActionBus),
    capture: createCaptureService({ store, timeZone: timeZone.current }),
    extraction,
    sync,
  };
}
