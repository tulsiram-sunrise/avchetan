import {
  type BriefRunner,
  createBriefRunner,
  createDeviceBriefMaker,
  type DeviceDeps,
  findDailyBrief,
} from '@avchetan/core';
import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { addDays, createLogger, type LocalDate, localDate, toAppError } from '@avchetan/shared';
import type { SyncEngine } from '@avchetan/sync';
import { emitAppEvent } from '../native/events';
import type { Platform } from '../platform';
import { announce } from './extraction';

const log = createLogger('brief');

/** The newest day a notification was shown for, so each brief notifies once. */
const BRIEF_NOTIFIED_SETTING = 'brief.notified';

async function saveSetting(store: ClientStore, key: string, value: unknown): Promise<void> {
  await store.write((tx) => setSetting(tx, key, value, store.clock.now()));
}

export type BriefService = BriefRunner & {
  /** Notifies about a brief that arrived from the hub. */
  checkReceived: () => Promise<void>;
};

/**
 * The daily brief on this PC (docs/product/daily-brief.md), made by core's device brief maker.
 * Runs in the dock, which never closes; this adds the notification and the Days page's state.
 */
export function createBriefService(deps: {
  device: DeviceDeps;
  platform: Platform;
  sync: SyncEngine;
}): BriefService {
  const { device, platform, sync } = deps;
  const { store } = device;
  const maker = createDeviceBriefMaker({ ...device, sync });

  async function make(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    void emitAppEvent('brief:state', { day, making: true }).catch(() => undefined);
    try {
      return await maker.make(day, replace);
    } finally {
      void announce(store, platform);
      void emitAppEvent('brief:state', { day, making: false }).catch(() => undefined);
    }
  }

  async function notify(day: LocalDate): Promise<void> {
    const notified = await getSetting(store.db, BRIEF_NOTIFIED_SETTING);
    if (typeof notified === 'string' && notified >= day) return;
    await saveSetting(store, BRIEF_NOTIFIED_SETTING, day);
    try {
      await platform.shell.notifyBrief(day);
    } catch (error) {
      log.warn('could not show the brief notification', { code: toAppError(error).code });
    }
  }

  const runner = createBriefRunner({
    store,
    scheduler: platform.scheduler,
    timeZone: device.timeZone,
    make: (day) => make(day, false),
    canMake: maker.canMake,
    beforeCheck: maker.beforeCheck,
    onMade: (day) => void notify(day),
  });

  return {
    ...runner,
    // Asked for in Days: the person is looking at it, so no notification.
    makeNow: async (day) => {
      await saveSetting(store, BRIEF_NOTIFIED_SETTING, day);
      return make(day, true);
    },
    async checkReceived() {
      const today = localDate(store.clock.now(), device.timeZone());
      for (const day of [addDays(today, -1), today]) {
        const brief = await findDailyBrief(store, day);
        if (brief && brief.deletedAt === null && brief.updatedByDevice !== store.deviceId) {
          await notify(day);
        }
      }
    },
  };
}
