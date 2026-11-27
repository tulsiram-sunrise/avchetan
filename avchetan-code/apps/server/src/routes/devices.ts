import { devices } from '@avchetan/db/pg';
import { registerDeviceRequestSchema } from '@avchetan/sync/protocol';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { MAX_DEVICES } from '../rate-limit';
import { readBody } from './read-body';

export function deviceRoutes({ db, clock, maxDevices = MAX_DEVICES }: AppDeps) {
  return new Hono<AppEnv>().post('/devices/register', async (c) => {
    const { deviceId, name, platform, extractionMode, timeZone, briefTime } = await readBody(
      c,
      registerDeviceRequestSchema,
    );
    const [known] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.id, deviceId));
    if (!known) {
      const [{ value } = { value: 0 }] = await db.select({ value: count() }).from(devices);
      if (value >= maxDevices) {
        throw new ApiError(409, 'device_limit', 'This server has as many devices as it takes', {
          max: maxDevices,
        });
      }
    }
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
