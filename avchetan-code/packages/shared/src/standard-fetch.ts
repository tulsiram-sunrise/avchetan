import type { HttpFetch } from './adapters';

function abortError(): Error {
  const error = new Error('The request was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * The apps' native fetches fail in their own ways, and the AI SDK and sync recognize neither:
 * expo/fetch rejects with a plain error, Tauri's HTTP plugin with a bare string (or a plain
 * "Request cancelled" error on abort). Without this, being offline or a model taking too long
 * shows up as "Something inside Avchetan went wrong" instead of the right error, and offline
 * counts against an entry instead of holding the queue. Only the signal can tell an abort from
 * a failed connection.
 */
export function withStandardFailures(base: HttpFetch): HttpFetch {
  return async (input, init) => {
    try {
      return await base(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw abortError();
      // The AI SDK reads `cause.message` into its "Cannot connect to API" error.
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new TypeError('fetch failed', { cause });
    }
  };
}
