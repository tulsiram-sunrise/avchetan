import { briefRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { readBody } from './read-body';

/** `POST /v1/brief`: the hub makes a day's daily brief for a device in `hub` mode. */
export function briefRoutes({ brief }: AppDeps) {
  return new Hono<AppEnv>().post('/brief', async (c) => {
    if (!brief) {
      throw new ApiError(503, 'ask_unavailable', 'This server has no model for the daily brief');
    }
    return c.json(await brief(await readBody(c, briefRequestSchema)));
  });
}
