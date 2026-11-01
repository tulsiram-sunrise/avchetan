import type { HttpFetch } from '@avchetan/shared';

function abortError(): Error {
  const error = new Error('The request was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * expo/fetch rejects with its own plain error both when a connection fails and when a request is
 * aborted, and the AI SDK recognizes neither. Without this, being offline counts against the
 * entry instead of holding the queue, and a timeout looks like being offline. Only the signal
 * can tell the two apart.
 */
export function withStandardFailures(base: HttpFetch): HttpFetch {
  return async (input, init) => {
    try {
      return await base(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw abortError();
      throw new TypeError('fetch failed', { cause: error });
    }
  };
}
