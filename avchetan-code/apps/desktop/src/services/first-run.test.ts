import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { saveConnection } from '@avchetan/sync';
import { describe, expect, it } from 'vitest';
import type { HubStatus } from '../native/hub';
import { finishSetup, needsSetup, setupMode } from './first-run';

function hubThatIs(enabled: boolean) {
  const status: HubStatus = {
    phase: enabled ? 'running' : 'off',
    config: { enabled, port: 8787, extraction: null, analysis: null, embedding: null },
    dataFolder: 'C:\\hub\\pglite-data',
    hasData: enabled,
    restarts: 0,
    error: null,
    logs: [],
  };
  return { status: async () => status };
}

describe('needsSetup', () => {
  it('is true on a new PC until setup is finished', async () => {
    const { store } = await openTestStore();
    expect(await needsSetup(store, hubThatIs(false))).toBe(true);
    await finishSetup(store, 'hub');
    expect(await needsSetup(store, hubThatIs(false))).toBe(false);
    expect(await setupMode(store)).toBe('hub');
  });

  it('never shows the wizard on a PC that was already in use', async () => {
    const withEntry = (await openTestStore()).store;
    await withEntry.write((tx) =>
      withEntry.repos.rawLogs.capture(tx, {
        content: 'Made-up entry',
        source: 'desktop_text',
        capturedTz: 'UTC',
      }),
    );
    expect(await needsSetup(withEntry, hubThatIs(false))).toBe(false);

    const withServer = (await openTestStore()).store;
    await saveConnection(withServer, new MemorySecretStore(), {
      urls: ['https://avchetan.example.org'],
      token: 'made-up-token',
      trustLocalNetwork: false,
    });
    expect(await needsSetup(withServer, hubThatIs(false))).toBe(false);

    const withHub = (await openTestStore()).store;
    expect(await needsSetup(withHub, hubThatIs(true))).toBe(false);
    // Marked done, with no mode, so it stays hidden even if all of that goes away.
    expect(await needsSetup(withHub, hubThatIs(false))).toBe(false);
    expect(await setupMode(withHub)).toBeNull();
  });
});
