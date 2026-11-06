import {
  type BriefRunner,
  type BriefSettings,
  createBriefRunner,
  findDailyBrief,
  type LlmDeps,
  type ModelConfig,
  makeDailyBrief,
} from '@avchetan/core';
import { devices } from '@avchetan/db/pg';
import { type Scheduler, TimerScheduler } from '@avchetan/shared';
import type { HubBriefRequest, HubBriefResponse } from '@avchetan/sync/protocol';
import { and, desc, isNotNull, ne } from 'drizzle-orm';
import type { ServerDb } from '../db/client';
import type { ServerDevice } from '../fallback/server-device';

export type HubBrief = (request: Required<HubBriefRequest>) => Promise<HubBriefResponse>;

/** Whose day the server follows: the device seen most recently that said when its days end. */
export async function briefSettingsFromDevices(
  db: ServerDb,
): Promise<{ settings: BriefSettings; timeZone: string } | null> {
  const [latest] = await db
    .select({ timeZone: devices.timeZone, briefTime: devices.briefTime })
    .from(devices)
    .where(and(ne(devices.platform, 'server'), isNotNull(devices.timeZone)))
    .orderBy(desc(devices.lastSeenAt))
    .limit(1);
  if (!latest?.timeZone) return null;
  return {
    timeZone: latest.timeZone,
    settings: { enabled: latest.briefTime !== null, time: latest.briefTime ?? '21:00' },
  };
}

/**
 * The hub's daily brief (docs/product/daily-brief.md), made on the server's own device with
 * the hub's analysis model, like hub Ask (ADR-0022): on request from a device in `hub` mode,
 * and on its own `graceMinutes` after the brief time when no device made it.
 */
export function createHubBrief(deps: {
  db: ServerDb;
  device: ServerDevice;
  model: ModelConfig;
  llm: LlmDeps;
  graceMinutes: number;
  scheduler?: Scheduler;
}): { handle: HubBrief; runner: BriefRunner } {
  const { device } = deps;
  let followed: string | null = null;

  async function make(day: string, timeZone: string): Promise<'made' | 'empty'> {
    const result = await makeDailyBrief(
      device.store,
      { day, timeZone, models: [deps.model] },
      deps.llm,
    );
    if (result.status === 'made') await device.engine.syncNow();
    return result.status;
  }

  const runner = createBriefRunner({
    store: device.store,
    scheduler: deps.scheduler ?? new TimerScheduler(),
    timeZone: () => followed ?? 'UTC',
    canMake: async () => true,
    settings: async () => {
      const found = await briefSettingsFromDevices(deps.db);
      followed = found?.timeZone ?? null;
      return found?.settings ?? null;
    },
    beforeCheck: () => device.engine.syncNow(),
    make: (day) => make(day, followed ?? 'UTC'),
    graceMinutes: deps.graceMinutes,
  });

  const handle: HubBrief = async ({ date, timeZone, replace }) => {
    // An entry typed just before asking should be in the brief.
    await device.engine.syncNow();
    if (!replace && (await findDailyBrief(device.store, date))) return { status: 'exists' };
    return { status: await make(date, timeZone) };
  };

  return { handle, runner };
}
