import { requireOptionalNativeModule } from 'expo';

type Found = { host: string; port: number };

/** Android's service discovery (android/…/HubDiscoveryModule.kt); absent in tests and on the web. */
const native = requireOptionalNativeModule<{ discover(timeoutMs: number): Promise<Found[]> }>(
  'HubDiscovery',
);

/**
 * Hubs announcing themselves on this network (docs/product/tasks-routines-reminders.md §15), as
 * addresses to try. Looks for `timeoutMs`, then stops. Each must still prove it is this
 * device's hub before anything is sent to it (ADR-0033).
 */
export async function discoverHubs(timeoutMs = 3_000): Promise<string[]> {
  if (!native) return [];
  const found = await native.discover(timeoutMs);
  return found.map(({ host, port }) => `http://${host}:${port}`);
}
