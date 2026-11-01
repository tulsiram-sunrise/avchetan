import { devices } from '@avchetan/db/pg';
import { registerDeviceRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../app';
import { readBody } from './read-body';

export function deviceRoutes({ db, clock }: AppDeps) {
  return new Hono<AppEnv>().post('/devices/register', async (c) => {
    const { deviceId, name, platform, extractionMode } = await readBody(
      c,
      registerDeviceRequestSchema,
    );
    const now = clock.now();
    await db
      .insert(devices)
      .values({ id: deviceId, name, platform, extractionMode, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: devices.id,
        set: { name, platform, extractionMode, lastSeenAt: now },
      });
    return c.json({ deviceId, serverTime: now });
  });
}
