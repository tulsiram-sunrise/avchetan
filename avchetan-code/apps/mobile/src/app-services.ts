import type { PendingProcessor } from '@avchetan/core';
import { type ClientStore, openClientStore } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { createExpoPlatform, type Platform } from './platform';
import { refreshAll } from './query-client';
import { type CaptureService, createCaptureService } from './services/capture';
import { createExtractionService } from './services/extraction';

const log = createLogger('app');

export type AppServices = {
  platform: Platform;
  store: ClientStore;
  capture: CaptureService;
  extraction: PendingProcessor;
};

/** Wires the packages: native database → client store → services. */
async function openAppServices(platform: Platform): Promise<AppServices> {
  const started = performance.now();
  const store = await openClientStore({ executor: platform.sqlite });
  log.info('store ready', { durationMs: Math.round(performance.now() - started) });
  return {
    platform,
    store,
    capture: createCaptureService(store),
    extraction: createExtractionService(store, platform, refreshAll),
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
