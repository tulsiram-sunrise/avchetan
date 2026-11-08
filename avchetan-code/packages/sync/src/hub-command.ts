import { SyncError, toAppError } from '@avchetan/shared';
import { createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import type { HubCommandRequest, HubCommandResponse } from './protocol';
import type { SearchDeps } from './search';

/**
 * Asks this device's hub to read what was typed after `/` as a command, with its answers model
 * (docs/product/command-mode.md). Only the typed words and earlier confirmed readings are sent.
 */
export async function requestHubCommand(
  { store, fetch, secrets }: SearchDeps,
  request: HubCommandRequest,
): Promise<HubCommandResponse> {
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
    try {
      return await api.command(request);
    } catch (error) {
      // A hub from before /v1/command doesn't know the endpoint.
      if (toAppError(error).code === 'not_found') {
        throw new SyncError('hub_outdated', 'Your hub needs an update to do this', {
          cause: error,
        });
      }
      throw error;
    }
  }
  throw new SyncError('server_unreachable', 'Your hub could not be reached');
}
