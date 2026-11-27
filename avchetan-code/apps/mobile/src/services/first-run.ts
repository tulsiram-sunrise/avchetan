import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { loadServerUrls } from '@avchetan/sync';
import { z } from 'zod';

const SETUP_MODES = ['standalone', 'connect'] as const;
export type SetupMode = (typeof SETUP_MODES)[number];

const DONE = defineSetting('setup.completed', z.boolean(), false);
/** How this phone was set up; Setup check uses it to know what to test. */
const MODE = defineSetting('setup.mode', z.enum(SETUP_MODES).nullable(), null);

/**
 * True on a first run only (docs/conventions/onboarding-and-user-docs.md). A phone that already
 * has entries or a server was set up before the wizard existed: it is marked done.
 */
export async function needsSetup(store: ClientStore): Promise<boolean> {
  if (await DONE.load(store.db)) return false;
  const [anyEntry, urls] = await Promise.all([
    store.db.query.rawLogs.findFirst({ columns: { id: true } }),
    loadServerUrls(store),
  ]);
  const setUpBefore = anyEntry !== undefined || urls.length > 0;
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
