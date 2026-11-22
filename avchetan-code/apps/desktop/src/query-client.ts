import { createLogger, errorFields, type Logger } from '@avchetan/shared';
import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';

/** A key's first part names the read (`['logs', day]`); the rest can hold what the user typed. */
const keyName = (key: QueryKey | undefined): string | undefined =>
  typeof key?.[0] === 'string' ? key[0] : undefined;

/**
 * The app's query client. Every failed read or action is logged where it happened, with its code
 * and where it was thrown, so an error that is only shown on screen (a model's Test button) is in
 * the log too (docs/conventions/errors-and-logging.md).
 */
export function createQueryClient(log: Logger = createLogger('ui')): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) =>
        log.error('read failed', { query: keyName(query.queryKey), ...errorFields(error) }),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        log.error('action failed', {
          action: keyName(mutation.options.mutationKey),
          ...errorFields(error),
        }),
    }),
    // Local SQLite reads are cheap and change only through our own writes.
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
}
