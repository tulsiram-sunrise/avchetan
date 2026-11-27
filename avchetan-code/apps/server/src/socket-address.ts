import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/**
 * The network address a request came from, or `undefined` for a request with no socket: the
 * server's own device calls `app.fetch` in-process (ADR-0021), and Hono's `getConnInfo` throws
 * on such a request, which once failed every sync of that device.
 */
export function socketAddress(c: Context): string | undefined {
  const env: unknown = c.env;
  if (!env || typeof env !== 'object') return undefined;
  if (!('incoming' in env) && !('server' in env)) return undefined;
  return getConnInfo(c).remote.address;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether a request came from the server's own machine. */
export const isLoopback = (address: string | undefined) => !!address && LOOPBACK.has(address);
