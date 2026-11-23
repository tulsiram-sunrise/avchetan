import type { SharedCommandDeps } from '@avchetan/core';
import { localDate, systemTimeZone } from '@avchetan/shared';
import { loadSyncStatus } from '@avchetan/sync';
import { router } from 'expo-router';
import type { AppServices } from '../app-services';
import { refreshAll } from '../query-client';
import { scheduleNotifications } from './notifications';
import { writeContext } from './writes';

/** Core's shared command deps on the phone. */
export function phoneCommandDeps(services: AppServices): SharedCommandDeps {
  const { store, sync, brief, undo } = services;
  return {
    write: writeContext(store),
    words: { device: 'phone', syncPlace: 'More → Sync' },
    today: () => localDate(store.clock.now(), systemTimeZone()),
    makeBrief: (day) => brief.makeNow(day),
    async syncNow() {
      await sync.syncNow();
      return (await loadSyncStatus(store)).state;
    },
    openDays: async () => {
      router.navigate('/');
    },
    openSearch: async () => {
      router.push('/search');
    },
    changed() {
      refreshAll();
      sync.schedule();
      // A task done or reopened changes which reminders ring.
      void scheduleNotifications(store);
    },
    undo,
  };
}
