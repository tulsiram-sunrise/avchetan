import { commandRequestSchema } from '@avchetan/sync/protocol';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { readBody } from './read-body';

/** `POST /v1/command`: the hub reads an unknown `/` command for a device in `hub` mode. */
export function commandRoutes({ command }: AppDeps) {
  return new Hono<AppEnv>().post('/command', async (c) => {
    if (!command) {
      throw new ApiError(503, 'ask_unavailable', 'This server has no model for reading commands');
    }
    return c.json(await command(await readBody(c, commandRequestSchema)));
  });
}
