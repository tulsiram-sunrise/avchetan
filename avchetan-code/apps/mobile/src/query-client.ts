import { createLogger, errorFields } from '@avchetan/shared';
import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';

const log = createLogger('ui');

/** A key's first part names the read (`['logs', day]`); the rest can hold what the user typed. */
const keyName = (key: QueryKey | undefined): string | undefined =>
  typeof key?.[0] === 'string' ? key[0] : undefined;

/**
 * Reads are local, so errors should show at once instead of retrying. Every failed read or
 * action is logged with its code and where it was thrown, so an error that is only shown on
 * screen is in the log too (docs/conventions/errors-and-logging.md).
 */
export const queryClient = new QueryClient({
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
  defaultOptions: { queries: { retry: false } },
});

/** Writes and the processor refresh everything: reads are cheap local queries. */
export function refreshAll(): void {
  void queryClient.invalidateQueries();
}
