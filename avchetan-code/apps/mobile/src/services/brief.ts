import {
  type BriefRunner,
  createBriefRunner,
  createDeviceBriefMaker,
  type DeviceDeps,
} from '@avchetan/core';
import type { LocalDate } from '@avchetan/shared';
import type { SyncEngine } from '@avchetan/sync';
import type { Platform } from '../platform';
import { refreshAll } from '../query-client';

export type BriefService = BriefRunner & {
  /** Days being made right now, for the Days screen. */
  making: () => ReadonlySet<LocalDate>;
};

/**
 * The daily brief on the phone (docs/product/daily-brief.md), made by core's device brief
 * maker. Android can't be counted on to run the app at the brief time, so it is made when the
 * app is open: on start, when Days opens, and when the reminder is tapped.
 */
export function createBriefService(deps: {
  device: DeviceDeps;
  platform: Platform;
  sync: SyncEngine;
}): BriefService {
  const { device, platform, sync } = deps;
  const maker = createDeviceBriefMaker({ ...device, sync });
  const making = new Set<LocalDate>();

  async function make(day: LocalDate, replace: boolean): Promise<'made' | 'empty'> {
    making.add(day);
    refreshAll();
    try {
      return await maker.make(day, replace);
    } finally {
      making.delete(day);
      refreshAll();
    }
  }

  const runner = createBriefRunner({
    store: device.store,
    scheduler: platform.scheduler,
    timeZone: device.timeZone,
    make: (day) => make(day, false),
    canMake: maker.canMake,
    beforeCheck: maker.beforeCheck,
  });

  return {
    ...runner,
    makeNow: (day) => make(day, true),
    making: () => making,
  };
}
