import { connectHub } from './find-server';
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
  const api = await connectHub({ store, fetch, secrets });
  return api.brief(request);
}
