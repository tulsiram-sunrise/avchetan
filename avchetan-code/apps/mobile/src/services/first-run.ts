import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { loadServerUrls } from '@avchetan/sync';

const DONE_KEY = 'setup.completed';
/** How this phone was set up; Setup check uses it to know what to test. */
const MODE_KEY = 'setup.mode';

export type SetupMode = 'standalone' | 'connect';

/**
 * True on a first run only (docs/conventions/onboarding-and-user-docs.md). A phone that already
 * has entries or a server was set up before the wizard existed: it is marked done.
 */
export async function needsSetup(store: ClientStore): Promise<boolean> {
  if ((await getSetting(store.db, DONE_KEY)) === true) return false;
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
    await setSetting(tx, DONE_KEY, true, now);
    if (mode) await setSetting(tx, MODE_KEY, mode, now);
  });
}
