import { type ClientStore, SYNCED_TABLES } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { createSyncEngine, loadSyncStatus, type SyncEngine, saveConnection } from '@avchetan/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import { openPglite, type ServerDatabase } from './db/client';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const URL = 'https://hub.test';
const START = '2026-10-26T10:00:00.000Z';

type Device = {
  store: ClientStore;
  engine: SyncEngine;
  advance: (ms: number) => void;
  network: FakeNetworkMonitor;
};

let database: ServerDatabase;
let serverFetch: HttpFetch;
let serverMs: number;

beforeEach(async () => {
  database = await openPglite();
  serverMs = Date.parse(START);
  const clock = createMonotonicClock({ source: () => serverMs });
  await database.migrate(() => clock.now());
  const identity = await loadServerIdentity(database.db, TOKEN);
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    nowMs: () => serverMs,
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
});

afterEach(() => database.close());

async function device(fetch: HttpFetch = (input, init) => serverFetch(input, init)) {
  const { store, advance } = await openTestStore({
    start: START,
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
  return { store, engine, advance, network } satisfies Device;
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
