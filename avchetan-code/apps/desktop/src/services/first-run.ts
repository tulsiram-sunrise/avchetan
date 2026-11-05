import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { loadServerUrls } from '@avchetan/sync';
import type { Hub } from '../native/hub';

const DONE_KEY = 'setup.completed';
/** Which way this PC was set up; Setup check uses it to know what to test. */
const MODE_KEY = 'setup.mode';

export const SETUP_MODES = ['standalone', 'hub', 'connect'] as const;
export type SetupMode = (typeof SETUP_MODES)[number];

/**
 * True on a first run only (docs/conventions/onboarding-and-user-docs.md). A PC that already
 * has entries, a server or a hub was set up before the wizard existed: it is marked done.
 */
export async function needsSetup(store: ClientStore, hub: Pick<Hub, 'status'>): Promise<boolean> {
  if ((await getSetting(store.db, DONE_KEY)) === true) return false;
  const [anyEntry, urls, hubStatus] = await Promise.all([
    store.db.query.rawLogs.findFirst({ columns: { id: true } }),
    loadServerUrls(store),
    hub.status(),
  ]);
  const setUpBefore = anyEntry !== undefined || urls.length > 0 || hubStatus.config.enabled;
  if (setUpBefore) await finishSetup(store, null);
  return !setUpBefore;
}

/** `mode` is null when the user skipped choosing. */
export async function finishSetup(store: ClientStore, mode: SetupMode | null): Promise<void> {
  const now = store.clock.now();
  await store.write(async (tx) => {
    await setSetting(tx, DONE_KEY, true, now);
    if (mode) await setSetting(tx, MODE_KEY, mode, now);
  });
}

export async function setupMode(store: ClientStore): Promise<SetupMode | null> {
  const mode = await getSetting(store.db, MODE_KEY);
  return SETUP_MODES.find((m) => m === mode) ?? null;
}
