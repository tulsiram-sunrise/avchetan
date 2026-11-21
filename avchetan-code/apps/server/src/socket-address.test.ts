import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { socketAddress } from './socket-address';

const app = new Hono().get('/', (c) => c.json({ address: socketAddress(c) ?? null }));

async function addressFor(env?: unknown) {
  const response = await app.request('/', {}, env);
  expect(response.status).toBe(200);
  return ((await response.json()) as { address: string | null }).address;
}

describe('socketAddress', () => {
  it('is empty for an in-process request, which has no socket', async () => {
    expect(await addressFor()).toBeNull();
  });

  it("reads Node's socket", async () => {
    const incoming = { socket: { remoteAddress: '192.168.1.40', remotePort: 5000 } };
    expect(await addressFor({ incoming })).toBe('192.168.1.40');
  });
});
