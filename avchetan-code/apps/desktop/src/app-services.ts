import { type ClientStore, openClientStore } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import type { Platform } from './platform';
import { type CaptureService, createCaptureService } from './services/capture';

const log = createLogger('app');

export type AppServices = {
  platform: Platform;
  store: ClientStore;
  capture: CaptureService;
};

/** Wires the packages for one window: native database → client store → services. */
export async function openAppServices(platform: Platform): Promise<AppServices> {
  const started = performance.now();
  await platform.openDatabase();
  const store = await openClientStore({ executor: platform.sqlite });
  log.info('store ready', { durationMs: Math.round(performance.now() - started) });
  return { platform, store, capture: createCaptureService({ store }) };
}
