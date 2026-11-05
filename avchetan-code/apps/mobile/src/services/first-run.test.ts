import { getSetting } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { saveConnection } from '@avchetan/sync';
import { describe, expect, it } from 'vitest';
import { finishSetup, needsSetup } from './first-run';

describe('needsSetup', () => {
  it('is true on a new phone until setup is finished', async () => {
    const { store } = await openTestStore();
    expect(await needsSetup(store)).toBe(true);
    await finishSetup(store, 'connect');
    expect(await needsSetup(store)).toBe(false);
    expect(await getSetting(store.db, 'setup.mode')).toBe('connect');
  });

  it('never shows the welcome screen on a phone that was already in use', async () => {
    const withEntry = (await openTestStore()).store;
    await withEntry.write((tx) =>
      withEntry.repos.rawLogs.capture(tx, {
        content: 'Made-up entry',
        source: 'mobile_text',
        capturedTz: 'UTC',
      }),
    );
    expect(await needsSetup(withEntry)).toBe(false);

    const paired = (await openTestStore()).store;
    await saveConnection(paired, new MemorySecretStore(), {
      urls: ['http://100.64.0.1:8787'],
      token: 'made-up-token',
      trustLocalNetwork: false,
    });
    expect(await needsSetup(paired)).toBe(false);
  });
});
