import { devices } from '@avchetan/db/pg';
import { registerDeviceRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../app';
import { readBody } from './read-body';

export function deviceRoutes({ db, clock }: AppDeps) {
  return new Hono<AppEnv>().post('/devices/register', async (c) => {
    const { deviceId, name, platform, extractionMode, timeZone, briefTime } = await readBody(
      c,
      registerDeviceRequestSchema,
    );
    const now = clock.now();
    // Older apps send neither; keep what an earlier registration said.
    const brief = {
      ...(timeZone !== undefined ? { timeZone } : {}),
      ...(briefTime !== undefined ? { briefTime } : {}),
    };
    await db
      .insert(devices)
      .values({
        id: deviceId,
        name,
        platform,
        extractionMode,
        ...brief,
        createdAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: { name, platform, extractionMode, ...brief, lastSeenAt: now },
      });
    return c.json({ deviceId, serverTime: now });
  });
}
