import { SyncError, toAppError } from '@avchetan/shared';
import { connectHub } from './find-server';
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
  const api = await connectHub({ store, fetch, secrets });
  try {
    return await api.command(request);
  } catch (error) {
    // A hub from before /v1/command doesn't know the endpoint.
    if (toAppError(error).code === 'not_found') {
      throw new SyncError('hub_outdated', 'Your hub needs an update to do this', { cause: error });
    }
    throw error;
  }
}
