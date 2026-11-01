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

  it('reports an abort as one, so a timeout stays a timeout', async () => {
    // What expo/fetch really throws: a plain error, with nothing naming it an abort.
    const fetch = withStandardFailures(failingWith(new Error('fetch failed: canceled')));
    const controller = new AbortController();
    controller.abort();

    await expect(fetch('http://test.invalid', { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });

  it('still reports a connection failure when a signal was passed but not aborted', async () => {
    const fetch = withStandardFailures(failingWith(new Error('Failed to connect')));
    const { signal } = new AbortController();

    await expect(fetch('http://test.invalid', { signal })).rejects.toBeInstanceOf(TypeError);
  });
});
