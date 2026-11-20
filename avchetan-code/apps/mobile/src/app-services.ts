import type { PendingProcessor } from '@avchetan/core';
import { type ClientStore, openClientStore, startRoutineDays } from '@avchetan/db/sqlite';
import { createLogger, localDate, systemTimeZone } from '@avchetan/shared';
import type { SyncEngine } from '@avchetan/sync';
import { AppState } from 'react-native';
import { createExpoPlatform, type Platform } from './platform';
import { refreshAll } from './query-client';
import { type BriefService, createBriefService } from './services/brief';
import { type CaptureService, createCaptureService } from './services/capture';
import { scheduleChoreEvening } from './services/chore-evening';
import { startBackups } from './services/data';
import { createExtractionService } from './services/extraction';
import { createSyncService } from './services/sync';

const log = createLogger('app');

export type AppServices = {
  platform: Platform;
  store: ClientStore;
  capture: CaptureService;
  extraction: PendingProcessor;
  sync: SyncEngine;
  brief: BriefService;
};

/** Wires the packages: native database → client store → services. */
async function openAppServices(platform: Platform): Promise<AppServices> {
  const started = performance.now();
  const store = await openClientStore({ executor: platform.sqlite });
  log.info('store ready', { durationMs: Math.round(performance.now() - started) });
  // Each needs the other: organizing queues a sync, and a sync may bring entries to organize.
  const extraction = createExtractionService(store, platform, () => {
    refreshAll();
    // An entry may have ticked a chore, which takes it out of this evening's notification.
    void scheduleChoreEvening(store);
    // Off screen, Android has paused the timer the debounce waits on.
    if (AppState.currentState === 'active') sync.schedule();
    else void sync.syncNow();
  });
  const sync = createSyncService(store, platform, extraction);
  startBackups({ store, platform });
  // Today's routine days (ADR-0031), and the next day's once the date changes while open.
  startRoutineDays({
    store,
    scheduler: platform.scheduler,
    today: () => localDate(store.clock.now(), systemTimeZone()),
    onMade: () => {
      refreshAll();
      void scheduleChoreEvening(store);
    },
  });
  return {
    platform,
    store,
    capture: createCaptureService(store),
    extraction,
    sync,
    brief: createBriefService({ store, platform, sync }),
  };
}

let opening: Promise<AppServices> | null = null;

/**
 * The app's one set of services. The screens and the background task both ask for it, in either
 * order, and they must share a database connection and a processor. A failed open can be retried.
 */
export function getAppServices(): Promise<AppServices> {
  opening ??= createExpoPlatform()
    .then(openAppServices)
    .catch((error) => {
      opening = null;
      throw error;
    });
  return opening;
}
