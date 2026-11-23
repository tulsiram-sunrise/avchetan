import type { DeviceDeps, DeviceWords } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createHubClient } from '@avchetan/sync';
import type { Platform } from '../platform';

const WORDS: DeviceWords = { device: 'phone', modelsPlace: 'More → AI models' };

/** What Ask, the brief and command reading in core need from this phone. */
export function createDeviceDeps(
  store: ClientStore,
  platform: Platform,
  timeZone: () => string,
): DeviceDeps {
  const { fetch, secrets } = platform;
  return {
    store,
    platform,
    hub: createHubClient({ store, fetch, secrets }),
    timeZone,
    words: WORDS,
  };
}
