import type { PendingProcessor } from '@avchetan/core';
import { type ClientStore, openClientStore } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import type { Platform } from './platform';
import { type CaptureService, createCaptureService } from './services/capture';
import { createExtractionService } from './services/extraction';

const log = createLogger('app');

export type AppServices = {
  platform: Platform;
  store: ClientStore;
  capture: CaptureService;
  extraction: PendingProcessor;
};

/** Wires the packages for one window: native database → client store → services. */
export async function openAppServices(platform: Platform): Promise<AppServices> {
  const started = performance.now();
  await platform.openDatabase();
  const store = await openClientStore({ executor: platform.sqlite });
  log.info('store ready', { durationMs: Math.round(performance.now() - started) });
  return {
    platform,
    store,
    capture: createCaptureService({ store }),
    extraction: createExtractionService(store, platform),
  };
}
