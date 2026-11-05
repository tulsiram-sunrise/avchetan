import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const hub = { DB_DRIVER: 'pglite' };

describe('loadEnv', () => {
  it('keeps running when stdin closes unless the desktop app asks otherwise (ADR-0024)', () => {
    expect(loadEnv(hub).SHUTDOWN_ON_STDIN_CLOSE).toBe(false);
    expect(loadEnv({ ...hub, SHUTDOWN_ON_STDIN_CLOSE: 'true' }).SHUTDOWN_ON_STDIN_CLOSE).toBe(true);
    expect(() => loadEnv({ ...hub, SHUTDOWN_ON_STDIN_CLOSE: 'yes' })).toThrow();
  });
});
