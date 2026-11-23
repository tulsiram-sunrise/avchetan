import { loadServerUrls } from './config';
import { askHub } from './hub-ask';
import { requestHubBrief } from './hub-brief';
import { requestHubCommand } from './hub-command';
import { MAX_SEARCH_RESULTS } from './protocol';
import { type SearchDeps, searchServer } from './search';

/**
 * This device's hub, as `HubClient` in `@avchetan/core` describes it (core can't import sync,
 * so the apps make this and pass it in). Each call finds the hub as sync does.
 */
export function createHubClient(deps: SearchDeps) {
  return {
    isSetUp: async () => (await loadServerUrls(deps.store)).length > 0,
    ask: (request: { question: string; timeZone: string }, onText: (text: string) => void) =>
      askHub(deps, request, onText),
    brief: (request: { date: string; timeZone: string; replace: boolean }) =>
      requestHubBrief(deps, request),
    command: (request: {
      input: string;
      examples: { input: string; command: string; text: string }[];
    }) => requestHubCommand(deps, request),
    search: ({
      query,
      from,
      to,
    }: {
      query: string;
      from?: string | undefined;
      to?: string | undefined;
    }) =>
      searchServer(deps, {
        query,
        limit: MAX_SEARCH_RESULTS,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  };
}
