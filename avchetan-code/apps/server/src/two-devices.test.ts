import { buildExtractionInput, loadVocabulary } from '@avchetan/core';
import { tasks as serverTasks } from '@avchetan/db/pg';
import {
  type ClientStore,
  type ExtractionPlan,
  SYNCED_TABLES,
  seedCategoryId,
  setSyncState,
} from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import {
  createSyncEngine,
  loadPairingLink,
  loadServerStatus,
  loadSyncStatus,
  pairWithLink,
  rotateServerToken,
  type SyncEngine,
  saveConnection,
} from '@avchetan/sync';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import type { ServerDatabase } from './db/client';
import { openTestDatabase } from './db/testing';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const URL = 'https://hub.test';
const START = '2026-10-26T10:00:00.000Z';

type Device = {
  store: ClientStore;
  engine: SyncEngine;
  advance: (ms: number) => void;
  network: FakeNetworkMonitor;
  secrets: MemorySecretStore;
};

let database: ServerDatabase;
let serverFetch: HttpFetch;
let serverMs: number;

beforeEach(async () => {
  database = await openTestDatabase();
  serverMs = Date.parse(START);
  const clock = createMonotonicClock({ source: () => serverMs });
  await database.migrate(() => clock.now());
  const identity = await loadServerIdentity(database.db, TOKEN);
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    nowMs: () => serverMs,
    pairing: { urls: () => [URL], tokenFromEnv: false },
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
});

afterEach(() => database.close());

async function device(fetch: HttpFetch = (input, init) => serverFetch(input, init), start = START) {
  const { store, advance } = await openTestStore({
    start,
    newId: () => crypto.randomUUID(),
  });
  const secrets = new MemorySecretStore();
  const network = new FakeNetworkMonitor();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  const engine = createSyncEngine({
    store,
    fetch,
    secrets,
    network,
    scheduler: new ManualScheduler(),
    device: { name: 'Test', platform: 'android', extractionMode: 'self' },
  });
  return { store, engine, advance, network, secrets } satisfies Device;
}

const capture = ({ store }: Device, content: string) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'mobile_text', capturedTz: 'UTC' }),
  );

const addTask = ({ store }: Device, title: string) =>
  store.write((tx) => store.repos.tasks.create(tx, { title }));

async function snapshot({ store }: Device) {
  const tables = Object.entries(SYNCED_TABLES);
  const rows = await Promise.all(
    tables.map(async ([name, table]) => {
      const found = (await store.db.select().from(table)) as { id: string }[];
      return [name, found.sort((a, b) => a.id.localeCompare(b.id))] as const;
    }),
  );
  return Object.fromEntries(rows);
}

const titles = async ({ store }: Device) =>
  (await store.db.query.tasks.findMany({ where: (t, { isNull }) => isNull(t.deletedAt) })).map(
    (task) => task.title,
  );

async function converge(...devices: Device[]) {
  for (let round = 0; round < 2; round += 1) {
    for (const each of devices) await each.engine.syncNow();
  }
}

describe('pairing', () => {
  it('pairs a new phone from the desktop’s code, and a new token locks out the rest', async () => {
    const desktop = await device();
    await desktop.engine.syncNow();
    const fromDesktop = { store: desktop.store, fetch: serverFetch, secrets: desktop.secrets };
    const link = await loadPairingLink(fromDesktop);

    const { store } = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
    const secrets = new MemorySecretStore();
    await pairWithLink({ store, fetch: serverFetch, secrets }, link);
    const engine = createSyncEngine({
      store,
      fetch: serverFetch,
      secrets,
      network: new FakeNetworkMonitor(),
      scheduler: new ManualScheduler(),
      device: { name: 'Phone', platform: 'android', extractionMode: 'self' },
    });
    await engine.syncNow();
    expect((await loadSyncStatus(store)).state).toBe('synced');
    const { devices } = await loadServerStatus(fromDesktop);
    expect(devices.map((d) => d.name).sort()).toEqual(['Phone', 'Test']);

    await rotateServerToken(fromDesktop);
    await desktop.engine.syncNow();
    await engine.syncNow();

    expect((await loadSyncStatus(desktop.store)).state).toBe('synced');
    expect((await loadSyncStatus(store)).state).toBe('unauthorized');
  });
});

/** The server starting again on the same database, as after a restore or a move. */
async function restartServer(options: { resetDataEpoch: boolean }) {
  const clock = createMonotonicClock({ source: () => serverMs });
  const identity = await loadServerIdentity(database.db, TOKEN, options);
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    nowMs: () => serverMs,
    pairing: { urls: () => [URL], tokenFromEnv: false },
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
}

describe('a server whose data went back in time', () => {
  it('gets everything again from its devices when its data epoch changes', async () => {
    const desktop = await device();
    const phone = await device();
    await addTask(desktop, 'Before the snapshot');
    await converge(desktop, phone);
    await addTask(desktop, 'After the snapshot');
    await desktop.engine.syncNow();

    // Restoring a snapshot from before the second task: the server no longer has it.
    await database.db.delete(serverTasks).where(eq(serverTasks.title, 'After the snapshot'));
    await restartServer({ resetDataEpoch: true });
    await converge(desktop, phone);

    expect((await titles(phone)).sort()).toEqual(['After the snapshot', 'Before the snapshot']);
    const onServer = await database.db.select({ title: serverTasks.title }).from(serverTasks);
    expect(onServer.map((t) => t.title).sort()).toEqual([
      'After the snapshot',
      'Before the snapshot',
    ]);
  });

  it('carries on as before when only the server restarted', async () => {
    const desktop = await device();
    await addTask(desktop, 'Kept');
    await desktop.engine.syncNow();
    const before = await desktop.store.sync.getState('pull_cursor');
    const resend = vi.spyOn(desktop.store.sync, 'enqueueEverything');

    await restartServer({ resetDataEpoch: false });
    await desktop.engine.syncNow();

    expect(await desktop.store.sync.getState('pull_cursor')).toBe(before);
    expect(resend).not.toHaveBeenCalled();
  });

  it("doesn't send everything again from a device that never saw an epoch", async () => {
    const desktop = await device();
    await desktop.engine.syncNow();
    // A device from before data epochs existed.
    await desktop.store.write((tx) => setSyncState(tx, 'data_epoch', ''));
    const resend = vi.spyOn(desktop.store.sync, 'enqueueEverything');

    await restartServer({ resetDataEpoch: true });
    await desktop.engine.syncNow();

    expect(resend).not.toHaveBeenCalled();
    expect(await desktop.store.sync.getState('data_epoch')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('two devices and a server', () => {
  it('brings a capture from one device to the other', async () => {
    const phone = await device();
    const desktop = await device();
    const log = await capture(phone, 'an entry');

    await converge(phone, desktop);

    const received = await desktop.store.db.query.rawLogs.findFirst();
    expect(received).toEqual(log);
    expect(await phone.store.sync.listOutbox()).toEqual([]);
    expect((await loadSyncStatus(phone.store)).state).toBe('synced');
  });

  it('ends with identical rows on both sides', async () => {
    const phone = await device();
    const desktop = await device();
    await capture(phone, 'from the phone');
    await addTask(desktop, 'from the desktop');

    await converge(phone, desktop);

    expect(await snapshot(phone)).toEqual(await snapshot(desktop));
  });

  it('lets the later of two offline edits win everywhere', async () => {
    const phone = await device();
    const desktop = await device();
    const task = await addTask(phone, 'original');
    await converge(phone, desktop);

    await phone.store.write((tx) =>
      phone.store.repos.tasks.editByUser(tx, task.id, { title: 'earlier' }),
    );
    desktop.advance(5_000);
    await desktop.store.write((tx) =>
      desktop.store.repos.tasks.editByUser(tx, task.id, { title: 'later' }),
    );
    serverMs += 5_000;

    await converge(phone, desktop);

    expect(await titles(phone)).toEqual(['later']);
    expect(await titles(desktop)).toEqual(['later']);
  });

  it('lets a later delete beat an earlier edit', async () => {
    const phone = await device();
    const desktop = await device();
    const task = await addTask(phone, 'original');
    await converge(phone, desktop);

    await phone.store.write((tx) =>
      phone.store.repos.tasks.editByUser(tx, task.id, { title: 'edited' }),
    );
    desktop.advance(5_000);
    await desktop.store.write((tx) => desktop.store.repos.tasks.softDelete(tx, task.id));
    serverMs += 5_000;

    await converge(phone, desktop);

    expect(await titles(phone)).toEqual([]);
    expect(await titles(desktop)).toEqual([]);
  });

  it('lets an edit made after pulling beat a row from a faster clock', async () => {
    const phone = await device();
    const desktop = await device();
    const task = await addTask(desktop, 'original');
    desktop.advance(60_000);
    serverMs += 60_000;
    await desktop.store.write((tx) =>
      desktop.store.repos.tasks.editByUser(tx, task.id, { title: 'from the fast clock' }),
    );
    await converge(desktop, phone);

    // The phone's own clock is still a minute behind.
    await phone.store.write((tx) =>
      phone.store.repos.tasks.editByUser(tx, task.id, { title: 'made later, on the phone' }),
    );
    await converge(phone, desktop);

    expect(await titles(desktop)).toEqual(['made later, on the phone']);
  });

  it('survives an ack lost on the way back', async () => {
    let dropNextPush = true;
    const phone = await device(async (input, init) => {
      const response = await serverFetch(input, init);
      if (String(input).endsWith('/sync/push') && dropNextPush) {
        dropNextPush = false;
        throw new TypeError('connection dropped');
      }
      return response;
    });
    const desktop = await device();
    await capture(phone, 'an entry');

    await phone.engine.syncNow();
    expect((await loadSyncStatus(phone.store)).state).toBe('failed');
    expect((await phone.store.sync.listOutbox()).length).toBeGreaterThan(0);
    await converge(phone, desktop);

    expect(await phone.store.sync.listOutbox()).toEqual([]);
    expect(await desktop.store.db.query.rawLogs.findMany()).toHaveLength(1);
  });

  it('keeps an edit made while its push was in flight', async () => {
    let edit: (() => Promise<unknown>) | null = null;
    const phone = await device(async (input, init) => {
      const response = await serverFetch(input, init);
      if (String(input).endsWith('/sync/push') && edit) {
        await edit();
        edit = null;
      }
      return response;
    });
    const desktop = await device();
    const task = await addTask(phone, 'original');
    edit = () => {
      phone.advance(1_000);
      return phone.store.write((tx) =>
        phone.store.repos.tasks.editByUser(tx, task.id, { title: 'edited in flight' }),
      );
    };

    await phone.engine.syncNow();
    await converge(phone, desktop);

    expect(await titles(desktop)).toEqual(['edited in flight']);
  });

  it('holds a row back when the device clock is far ahead, and says so', async () => {
    const phone = await device();
    await phone.engine.syncNow();
    phone.advance(10 * 60_000);
    await addTask(phone, 'from the future');

    await phone.engine.syncNow();

    expect((await loadSyncStatus(phone.store)).clockSkew).toBe(true);
    expect(await phone.store.sync.listOutbox()).toHaveLength(1);
  });

  it('gives a new device everything, across pages', async () => {
    const phone = await device();
    for (let i = 0; i < 120; i += 1) await addTask(phone, `task ${i}`);
    await phone.engine.syncNow();

    const desktop = await device();
    await desktop.engine.syncNow();

    expect(await titles(desktop)).toHaveLength(120);
  });

  it('keeps a renamed default category when a new device joins later', async () => {
    const desktop = await device();
    const seed = await desktop.store.db.query.categories.findFirst({
      where: (c, { eq }) => eq(c.origin, 'seed'),
    });
    if (!seed) throw new Error('no seed category');
    await desktop.store.write((tx) =>
      desktop.store.repos.categories.rename(tx, seed.id, 'Renamed'),
    );
    await desktop.engine.syncNow();

    // Set up a day later, so its own copy of the default categories is newer than the rename.
    const phone = await device(undefined, '2026-10-27T10:00:00.000Z');
    serverMs += 86_400_000;
    await converge(phone, desktop);

    const nameOn = async ({ store }: Device) =>
      (await store.db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, seed.id) }))
        ?.name;
    expect(await nameOn(phone)).toBe('Renamed');
    expect(await nameOn(desktop)).toBe('Renamed');
  });

  it('does not put pulled rows back in the outbox', async () => {
    const phone = await device();
    const desktop = await device();
    await capture(phone, 'an entry');
    await phone.engine.syncNow();

    const outboxBefore = (await desktop.store.sync.listOutbox()).length;
    await desktop.engine.syncNow();
    await desktop.engine.syncNow();

    expect(outboxBefore).toBeGreaterThan(0);
    expect(await desktop.store.sync.listOutbox()).toEqual([]);
  });

  it('waits for the user on a bad token instead of retrying', async () => {
    const phone = await device();
    await saveConnection(phone.store, new MemorySecretStore(), {
      urls: [URL],
      token: 'x',
      trustLocalNetwork: false,
    });
    const spy = vi.fn(serverFetch);
    const engine = createSyncEngine({
      store: phone.store,
      fetch: spy,
      secrets: { get: async () => 'wrong-token' },
      network: phone.network,
      scheduler: new ManualScheduler(),
      device: { name: 'Test', platform: 'android', extractionMode: 'self' },
    });

    await engine.syncNow();

    expect((await loadSyncStatus(phone.store)).state).toBe('unauthorized');
  });

  it('stays quiet while offline or not configured', async () => {
    const spy = vi.fn(serverFetch);
    const phone = await device(spy);
    phone.network.setOnline(false);
    await phone.engine.syncNow();
    expect((await loadSyncStatus(phone.store)).state).toBe('offline');
    expect(spy).not.toHaveBeenCalled();

    const { store } = await openTestStore();
    const unconfigured = createSyncEngine({
      store,
      fetch: spy,
      secrets: new MemorySecretStore(),
      network: phone.network,
      scheduler: new ManualScheduler(),
      device: { name: 'Test', platform: 'android', extractionMode: 'self' },
    });
    await unconfigured.syncNow();
    expect((await loadSyncStatus(store)).state).toBe('not_configured');
  });

  it('sends its whole history to a new server it moves to', async () => {
    let target = serverFetch;
    const phone = await device((input, init) => target(input, init));
    await capture(phone, 'Walked to the park');
    await phone.engine.syncNow();

    // A fresh server (a cloud one, or a rebuilt hub) with the same token.
    const fresh = await openTestDatabase();
    const clock = createMonotonicClock({ source: () => serverMs });
    await fresh.migrate(() => clock.now());
    const app = createApp({
      db: fresh.db,
      identity: await loadServerIdentity(fresh.db, TOKEN),
      clock,
      version: 'test',
      profile: 'cloud',
      nowMs: () => serverMs,
      pairing: { urls: () => [URL], tokenFromEnv: true },
    });
    target = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
    try {
      await phone.engine.syncNow();
      const laptop = await device(target);
      await laptop.engine.syncNow();
      const contents = await laptop.store.db.query.rawLogs.findMany();
      expect(contents.map((log) => log.content)).toEqual(['Walked to the park']);
    } finally {
      await fresh.close();
    }
  });

  it('uses the next address when the first is down', async () => {
    const phone = await device(async (input, init) => {
      if (String(input).startsWith('https://down.test')) throw new TypeError('no route');
      return serverFetch(input, init);
    });
    await saveConnection(
      phone.store,
      { set: async () => {} },
      { urls: ['https://down.test/', URL], token: TOKEN, trustLocalNetwork: false },
    );

    await phone.engine.syncNow();

    expect((await loadSyncStatus(phone.store)).state).toBe('synced');
  });
});

describe('corrections across devices (ADR-0027)', () => {
  /** What the model made of the entry: a wrong category and a task that isn't one. */
  const organized = (rawLogId: string): ExtractionPlan => ({
    rawLogId,
    status: 'processed',
    model: 'mock:model',
    version: 3,
    activities: [
      {
        categoryId: seedCategoryId('other'),
        title: 'Pool',
        notes: null,
        metrics: {},
        loggedDate: '2026-10-26',
        projectId: null,
        tagPaths: [],
      },
    ],
    tasks: [
      {
        categoryId: null,
        title: 'Think about swimming',
        notes: null,
        dueDate: null,
        projectId: null,
        tagPaths: [],
      },
    ],
    logTagPaths: [],
    entities: [],
    newCategory: null,
    categorySuggestion: null,
  });

  async function correctOnPhone(phone: Device) {
    const log = await capture(phone, 'swam 20 laps at the pool');
    await phone.store.write((tx) => phone.store.repos.extraction.apply(tx, organized(log.id)));
    const {
      activities: [activity],
      tasks: [task],
    } = await phone.store.queries.extractedFrom(phone.store.db, [log.id]);
    if (!activity || !task) throw new Error('expected the entry to be organized');
    await phone.store.write((tx) =>
      phone.store.repos.activities.editByUser(tx, activity.id, {
        title: 'Swim',
        categoryId: seedCategoryId('workout'),
      }),
    );
    await phone.store.write((tx) => phone.store.repos.tasks.deleteByUser(tx, task.id));
    return log;
  }

  /** The examples the device would put in the prompt for a new entry. */
  async function examplesFor({ store }: Device, content: string) {
    const vocabulary = await loadVocabulary(
      store,
      { includePrivate: false },
      { corrections: true },
    );
    const input = buildExtractionInput(
      { id: 'new', content, context: {}, capturedAt: START, capturedTz: 'UTC', privacy: 'normal' },
      vocabulary,
    );
    return input.corrections;
  }

  it('a fix made on the phone teaches the desktop', async () => {
    const phone = await device();
    const desktop = await device();
    await correctOnPhone(phone);

    await converge(phone, desktop);

    expect(await examplesFor(desktop, 'swam 30 laps at the pool')).toEqual([
      'Past entry (2026-10-26): swam 20 laps at the pool\nactivity: workout | Swim\nnot task: Think about swimming',
    ]);
  });

  it('Forget on one device stops the example on the other', async () => {
    const phone = await device();
    const desktop = await device();
    const log = await correctOnPhone(phone);
    await converge(phone, desktop);

    await desktop.store.write((tx) => desktop.store.repos.rawLogs.forgetExample(tx, log.id));
    await converge(desktop, phone);

    expect(await examplesFor(phone, 'swam 30 laps at the pool')).toEqual([]);
  });
});
