import type { ClientStore } from '@avchetan/db/sqlite';
import type { NetworkMonitor } from '@avchetan/shared';
import type { ProviderDeps } from '../providers/registry';
import type { DeviceWords, HubClient } from './hub-client';

/** What Ask, the brief and command reading need from the device they run on. */
export type DeviceDeps = {
  store: ClientStore;
  platform: ProviderDeps & { network: NetworkMonitor };
  hub: HubClient;
  /** The device's current time zone (IANA). */
  timeZone: () => string;
  words: DeviceWords;
};
