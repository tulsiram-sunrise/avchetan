import type { RawLog } from '@avchetan/db/sqlite';
import { SyncError, toAppError } from '@avchetan/shared';
import { createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import type { HubAskRequest, HubAskResult } from './protocol';
import type { SearchDeps } from './search';

/**
 * Asks this device's hub to answer with its own model. Unlike search there is nothing to fall
 * back to, so a missing or unreachable hub is an error the Ask screen explains.
 */
export async function askServer(
  { store, fetch, secrets }: SearchDeps,
  request: HubAskRequest,
  onText: (text: string) => void,
): Promise<HubAskResult> {
  const urls = await loadServerUrls(store);
  const token = await secrets.get(SYNC_TOKEN_SECRET);
  if (urls.length === 0 || !token) {
    throw new SyncError('not_configured', 'Set up Sync first, so this device can reach your hub');
  }
  for (const baseUrl of urls) {
    try {
      // Fast, so a dead address costs seconds, not the answer's long timeout.
      await fetchHealth(fetch, baseUrl);
    } catch (error) {
      if (toAppError(error).code === 'server_unreachable') continue;
      throw error;
    }
    const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
    return api.ask(request, onText);
  }
  throw new SyncError('server_unreachable', 'Your hub could not be reached');
}

/** An answer from the hub with its sources found on this device, as Ask shows them. */
export type HubAnswer = { answer: string; sources: { number: number; rawLog: RawLog }[] };

/**
 * Asks the hub (ADR-0022) and links the entries it cites, which are already on this device
 * once synced. The Ask is recorded here, as an answer from this device's own model would be.
 */
export async function askHub(
  deps: SearchDeps,
  request: HubAskRequest,
  onText: (text: string) => void,
): Promise<HubAnswer> {
  const { store } = deps;
  const { answer, sources } = await askServer(deps, request, onText);
  const logs = await store.queries.logsById(
    store.db,
    sources.map((source) => source.rawLogId),
    { includePrivate: true },
  );
  const byId = new Map(logs.map((log) => [log.id, log]));
  const found = sources.flatMap(({ number, rawLogId }) => {
    const rawLog = byId.get(rawLogId);
    // Not synced here yet: the number stays in the answer, without a link.
    return rawLog ? [{ number, rawLog }] : [];
  });
  await store.recordAsk({
    question: request.question,
    answer,
    citedIds: found.map((s) => s.rawLog.id),
  });
  return { answer, sources: found };
}
