import type { HttpFetch } from '@avchetan/shared';

/**
 * expo/fetch rejects with its own error when a connection fails, which the AI SDK doesn't
 * recognize. Without this, being offline counts against the entry instead of holding the queue.
 */
export function withStandardFailures(base: HttpFetch): HttpFetch {
  return async (input, init) => {
    try {
      return await base(input, init);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new TypeError('fetch failed', { cause: error });
    }
  };
}
