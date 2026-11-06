import { SyncError, toAppError } from '@avchetan/shared';
import { createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import type { HubBriefRequest, HubBriefResponse } from './protocol';
import type { SearchDeps } from './search';

/**
 * Asks this device's hub to make a day's daily brief with its own model
 * (docs/product/daily-brief.md). The brief itself arrives with the next sync.
 */
export async function requestHubBrief(
  { store, fetch, secrets }: SearchDeps,
  request: HubBriefRequest,
): Promise<HubBriefResponse> {
  const urls = await loadServerUrls(store);
  const token = await secrets.get(SYNC_TOKEN_SECRET);
  if (urls.length === 0 || !token) {
    throw new SyncError('not_configured', 'Set up Sync first, so this device can reach your hub');
  }
  for (const baseUrl of urls) {
    try {
      await fetchHealth(fetch, baseUrl);
    } catch (error) {
      if (toAppError(error).code === 'server_unreachable') continue;
      throw error;
    }
    const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
    return api.brief(request);
  }
  throw new SyncError('server_unreachable', 'Your hub could not be reached');
}
