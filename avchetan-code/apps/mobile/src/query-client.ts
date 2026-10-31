import { QueryClient } from '@tanstack/react-query';

/** Reads are local, so errors should show at once instead of retrying. */
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Writes and the processor refresh everything: reads are cheap local queries. */
export function refreshAll(): void {
  void queryClient.invalidateQueries();
}
