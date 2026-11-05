import type { HttpFetch } from '@avchetan/shared';
import { describe, expect, it, vi } from 'vitest';
import { withoutOrigin } from './native-fetch';

describe('withoutOrigin', () => {
  it('asks for no Origin header and keeps the other headers', async () => {
    const inner = vi.fn<HttpFetch>(async () => new Response('ok'));
    await withoutOrigin(inner)('http://localhost:11434/api/tags', {
      headers: { Authorization: 'Bearer made-up' },
      signal: AbortSignal.timeout(1000),
    });
    const init = inner.mock.calls[0]?.[1] ?? {};
    const headers = new Headers(init.headers);
    expect(headers.get('Origin')).toBe('');
    expect(headers.get('Authorization')).toBe('Bearer made-up');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
