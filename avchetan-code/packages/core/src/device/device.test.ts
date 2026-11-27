import { openTestStore, readRawSetting, writeRawSetting } from '@avchetan/db/testing';
import { FakeNetworkMonitor, MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { loadBriefFailure } from '../analysis/brief-schedule';
import { MODEL_SLOTS_SETTING, saveAnalysisMode } from '../extraction/settings';
import { askQuestion } from './ask-question';
import { createDeviceBriefMaker } from './brief-maker';
import type { DeviceDeps } from './device-deps';
import type { HubClient } from './hub-client';
import { readCommand } from './read-command';

const DAY = '2026-10-26';
const cloud = { extraction: { provider: 'groq', model: 'test-model' } };
const local = { extraction: { provider: 'ollama', model: 'local-model' } };

function fakeHub(setUp = true) {
  return {
    isSetUp: vi.fn(async () => setUp),
    ask: vi.fn<HubClient['ask']>(async () => ({ answer: 'From the hub', sources: [] })),
    brief: vi.fn<HubClient['brief']>(async () => ({ status: 'made' as const })),
    command: vi.fn<HubClient['command']>(async () => ({ command: 'done', text: ' milk ' })),
    search: vi.fn<HubClient['search']>(async () => null),
  } satisfies HubClient;
}

async function device(options: {
  slots?: object;
  mode?: 'hub' | 'self';
  online?: boolean;
  hub?: ReturnType<typeof fakeHub>;
}) {
  const { store } = await openTestStore();
  if (options.slots) {
    const { slots } = options;
    await writeRawSetting(store, MODEL_SLOTS_SETTING.key, slots);
  }
  if (options.mode) await saveAnalysisMode(store, options.mode);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const hub = options.hub ?? fakeHub();
  const deps: DeviceDeps = {
    store,
    platform: {
      fetch,
      secrets: new MemorySecretStore(),
      network: new FakeNetworkMonitor(options.online ?? true),
    },
    hub,
    timeZone: () => 'UTC',
    words: { device: 'phone', modelsPlace: 'More → AI models' },
  };
  return { deps, store, fetch, hub };
}

describe('askQuestion', () => {
  it('asks for a model, saying where this device chooses one', async () => {
    const { deps } = await device({});

    await expect(askQuestion(deps, 'anything', () => {})).rejects.toMatchObject({
      code: 'llm_auth',
      message: 'Choose a model in More → AI models first',
    });
  });

  it('asks the hub when the hub answers, needing no model of its own', async () => {
    const { deps, hub, fetch } = await device({ mode: 'hub' });
    const onText = () => {};

    const result = await askQuestion(deps, 'how many runs?', onText);

    expect(result.answer).toBe('From the hub');
    expect(hub.ask).toHaveBeenCalledWith({ question: 'how many runs?', timeZone: 'UTC' }, onText);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers from local counts when offline with the hub answering', async () => {
    const { deps, hub } = await device({ mode: 'hub', online: false });

    const result = await askQuestion(deps, 'anything', () => {});

    expect(result.answer).toContain('From this phone: 0 activities today, 0 open tasks');
    expect(hub.ask).not.toHaveBeenCalled();
  });

  it("uses this device's model again once answers are switched back", async () => {
    const { deps, hub } = await device({ slots: cloud, mode: 'hub' });
    await saveAnalysisMode(deps.store, 'self');

    // The provider stage: the key is missing, not the model.
    await expect(askQuestion(deps, 'anything', () => {})).rejects.toMatchObject({
      message: 'No API key is set for this provider',
    });
    expect(hub.ask).not.toHaveBeenCalled();
  });

  it('answers from local counts when offline with a cloud model, sending nothing', async () => {
    const { deps, fetch } = await device({ slots: cloud, online: false });

    const result = await askQuestion(deps, 'anything', () => {});

    expect(result.answer).toContain("You're offline");
    expect(result.sources).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('device brief maker', () => {
  function maker(deps: DeviceDeps) {
    const sync = { syncNow: vi.fn(async () => undefined), schedule: vi.fn() };
    return { brief: createDeviceBriefMaker({ ...deps, sync }), sync };
  }

  it('asks the hub, then syncs to fetch the brief it made', async () => {
    const { deps, hub } = await device({ mode: 'hub' });
    const { brief, sync } = maker(deps);

    await expect(brief.make(DAY, true)).resolves.toBe('made');

    expect(hub.brief).toHaveBeenCalledWith({ date: DAY, timeZone: 'UTC', replace: true });
    expect(sync.syncNow).toHaveBeenCalledOnce();
    expect(await loadBriefFailure(deps.store)).toBeNull();
  });

  it.each([
    ['exists', 'made'],
    ['empty', 'empty'],
  ] as const)('a hub brief that is %s counts as %s', async (status, expected) => {
    const hub = fakeHub();
    hub.brief.mockResolvedValue({ status });
    const { deps } = await device({ mode: 'hub', hub });

    await expect(maker(deps).brief.make(DAY, false)).resolves.toBe(expected);
  });

  it('records why it failed for the Days page, then clears it once one is made', async () => {
    const { deps } = await device({ mode: 'hub', online: false });
    const { brief } = maker(deps);

    await expect(brief.make(DAY, false)).rejects.toMatchObject({
      code: 'server_unreachable',
      message: 'This phone is offline',
    });
    expect(await loadBriefFailure(deps.store)).toMatchObject({
      day: DAY,
      code: 'server_unreachable',
    });

    (deps.platform.network as FakeNetworkMonitor).setOnline(true);
    await brief.make(DAY, false);
    expect(await loadBriefFailure(deps.store)).toBeNull();
  });

  it('asks for a model when this device makes it and has none', async () => {
    const { deps } = await device({});

    await expect(maker(deps).brief.make(DAY, false)).rejects.toMatchObject({
      code: 'llm_auth',
      message: 'Choose a model in More → AI models first',
    });
    expect(await loadBriefFailure(deps.store)).toMatchObject({ code: 'llm_auth' });
  });

  it.each([
    ['the hub, online and set up', { mode: 'hub', online: true, setUp: true }, true],
    ['the hub, offline', { mode: 'hub', online: false, setUp: true }, false],
    ['the hub, not set up', { mode: 'hub', online: true, setUp: false }, false],
    ['no model', { online: true, setUp: true }, false],
    ['a cloud model, online', { slots: cloud, online: true, setUp: false }, true],
    ['a cloud model, offline', { slots: cloud, online: false, setUp: false }, false],
    ['a local model, offline', { slots: local, online: false, setUp: false }, true],
  ] as const)('can make one with %s: %s', async (_name, options, expected) => {
    const { deps } = await device({ ...options, hub: fakeHub(options.setUp) });

    await expect(maker(deps).brief.canMake()).resolves.toBe(expected);
  });

  it('syncs before checking only when a hub is set up', async () => {
    const withHub = maker((await device({ hub: fakeHub(true) })).deps);
    const alone = maker((await device({ hub: fakeHub(false) })).deps);

    await withHub.brief.beforeCheck();
    await alone.brief.beforeCheck();

    expect(withHub.sync.syncNow).toHaveBeenCalledOnce();
    expect(alone.sync.syncNow).not.toHaveBeenCalled();
  });
});

describe('readCommand', () => {
  it('lets the hub read it, with the words trimmed', async () => {
    const { deps, hub } = await device({ mode: 'hub' });

    await expect(readCommand(deps, 'bought the milk')).resolves.toEqual({
      command: 'done',
      text: 'milk',
    });
    expect(hub.command).toHaveBeenCalledWith({ input: 'bought the milk', examples: [] });
  });

  it.each([
    ['no command', null],
    ['a command this device does not know', 'teleport'],
  ])('counts %s from the hub as unknown', async (_name, command) => {
    const hub = fakeHub();
    hub.command.mockResolvedValue({ command, text: '' });
    const { deps } = await device({ mode: 'hub', hub });

    await expect(readCommand(deps, 'something')).rejects.toMatchObject({
      code: 'command_unknown',
    });
  });

  it('says the hub is out of reach when offline', async () => {
    const { deps, hub } = await device({ mode: 'hub', online: false });

    await expect(readCommand(deps, 'x')).rejects.toMatchObject({
      code: 'llm_unavailable',
      message: 'This phone is offline, so your hub can’t read this command',
    });
    expect(hub.command).not.toHaveBeenCalled();
  });

  it('asks for a model when this device reads it and has none', async () => {
    const { deps } = await device({});

    await expect(readCommand(deps, 'x')).rejects.toMatchObject({
      code: 'llm_auth',
      message: 'Reading commands needs a model in More → AI models',
    });
  });

  it('sends nothing when offline with a cloud model', async () => {
    const { deps, fetch } = await device({ slots: cloud, online: false });

    await expect(readCommand(deps, 'x')).rejects.toMatchObject({ code: 'llm_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
