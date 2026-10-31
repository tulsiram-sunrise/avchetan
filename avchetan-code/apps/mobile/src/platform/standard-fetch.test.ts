import { describe, expect, it } from 'vitest';
import { withStandardFailures } from './standard-fetch';

const failingWith = (error: unknown) => async () => {
  throw error;
};

describe('withStandardFailures', () => {
  it('passes responses through', async () => {
    const response = new Response('ok');
    const fetch = withStandardFailures(async () => response);

    await expect(fetch('http://test.invalid')).resolves.toBe(response);
  });

  it('reports a connection failure the way standard fetch does', async () => {
    const cause = new Error('Failed to connect');
    const fetch = withStandardFailures(failingWith(cause));

    const failure = await fetch('http://test.invalid').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).toMatchObject({ message: 'fetch failed', cause });
  });

  it('leaves an abort alone, so a timeout stays a timeout', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const fetch = withStandardFailures(failingWith(abort));

    await expect(fetch('http://test.invalid')).rejects.toBe(abort);
  });
});
