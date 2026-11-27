import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { loadServerUrls } from '@avchetan/sync';
import { z } from 'zod';
import type { Hub } from '../native/hub';

export const SETUP_MODES = ['standalone', 'hub', 'connect'] as const;
export type SetupMode = (typeof SETUP_MODES)[number];

const DONE = defineSetting('setup.completed', z.boolean(), false);
/** Which way this PC was set up; Setup check uses it to know what to test. */
const MODE = defineSetting('setup.mode', z.enum(SETUP_MODES).nullable(), null);

/**
 * True on a first run only (docs/conventions/onboarding-and-user-docs.md). A PC that already
 * has entries, a server or a hub was set up before the wizard existed: it is marked done.
 */
export async function needsSetup(store: ClientStore, hub: Pick<Hub, 'status'>): Promise<boolean> {
  if (await DONE.load(store.db)) return false;
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
    await DONE.save(tx, true, now);
    if (mode) await MODE.save(tx, mode, now);
  });
}

export async function setupMode(store: ClientStore): Promise<SetupMode | null> {
  return MODE.load(store.db);
}
