import { openTestStore } from '@avchetan/db/testing';
import type { HttpFetch, RepeatRule } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { saveConnection } from './config';
import { createSyncEngine, type PullProgress, type SyncDevice } from './engine';
import type { PushRejection } from './protocol';
import { describeSync, INITIAL_STATUS, loadSyncStatus } from './status';

/**
 * The engine against a scripted server: no PGlite, no HTTP, so each case runs in milliseconds.
 * The full round trip through the real server is in apps/server/src/two-devices.test.ts.
 */

const URL = 'https://hub.test';
const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const SERVER_ID = '0192a000-0000-7000-8000-00000000aaaa';
const EPOCH = '0192a000-0000-7000-8000-00000000bbbb';

type Change = { table: string; row: Record<string, unknown> };
type Call = {
  host: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  token: string | null;
};
type Scripted = { status: number; body: unknown };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const failure = (status: number, code: string): Scripted => ({
  status,
  body: { error: { code, message: 'scripted', requestId: 'r' } },
});

/** Answers like the real server, unless a test scripts the next answer for a path. */
class FakeServer {
  readonly calls: Call[] = [];
  /** What pulls hand out, in order (rows from other devices). */
  readonly log: Change[] = [];
  /** Rows this device pushed and the server took. */
  readonly received: Change[] = [];
  readonly refused = new Map<string, PushRejection>();
  /** How many times each row ID was pushed. */
  readonly pushed = new Map<string, number>();
  private readonly scripted = new Map<string, (Scripted | Error | 'pass')[]>();
  down = false;
  /** What health says: change them to play another server, or a restored one. */
  serverId = SERVER_ID;
  dataEpoch = EPOCH;
  /** Other machines at some hosts: they answer health as another server, and nothing else. */
  readonly strangers = new Map<string, string>();

  /** The next answer to `path`: an Error never gets there, 'pass' answers as usual. */
  next(path: string, answer: Scripted | Error | 'pass'): void {
    const queue = this.scripted.get(path) ?? [];
    queue.push(answer);
    this.scripted.set(path, queue);
  }

  count(path: string): number {
    return this.calls.filter((call) => call.path === path).length;
  }

  readonly fetch: HttpFetch = async (input, init) => {
    const url = new globalThis.URL(String(input));
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    const token = new Headers(init?.headers).get('Authorization');
    this.calls.push({ host: url.host, path: url.pathname, query: url.searchParams, body, token });
    if (this.down) throw new TypeError('fetch failed');
    const stranger = this.strangers.get(url.host);
    if (stranger) {
      return json(200, { status: 'ok', version: 'other', serverId: stranger, protocol: 1 });
    }
    const script = this.scripted.get(url.pathname)?.shift();
    if (script instanceof Error) throw script;
    if (script && script !== 'pass') return json(script.status, script.body);
    return json(200, this.answer(url, body));
  };

  private answer(url: globalThis.URL, body: unknown): unknown {
    const serverTime = '2026-10-26T10:00:00.000Z';
    switch (url.pathname) {
      case '/v1/health':
        return {
          status: 'ok',
          version: 'test',
          serverId: this.serverId,
          dataEpoch: this.dataEpoch,
          protocol: 1,
        };
      case '/v1/devices/register':
        return { deviceId: (body as { deviceId: string }).deviceId, serverTime };
      case '/v1/sync/push': {
        const acked: { table: string; id: string }[] = [];
        const rejected: { table: string; id: string; code: PushRejection; message: string }[] = [];
        for (const { table, row } of (body as { changes: Change[] }).changes) {
          const id = String(row.id);
          this.pushed.set(id, (this.pushed.get(id) ?? 0) + 1);
          const code = this.refused.get(id);
          if (code) {
            rejected.push({ table, id, code, message: 'scripted' });
          } else {
            acked.push({ table, id });
            this.received.push({ table, row });
          }
        }
        return { acked, rejected, serverTime };
      }
      case '/v1/sync/pull': {
        const cursor = Number(url.searchParams.get('cursor') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        const page = this.log.slice(cursor, cursor + limit);
        const nextCursor = cursor + page.length;
        return {
          changes: page.map((change, index) => ({ ...change, seq: cursor + index + 1 })),
          nextCursor,
          hasMore: nextCursor < this.log.length,
          remaining: this.log.length - nextCursor,
        };
      }
      default:
        throw new Error(`The fake server has no ${url.pathname}`);
    }
  }
}

type SetupOptions = { pullPageSize?: number; online?: boolean };

async function setup(options: SetupOptions = {}) {
  const server = new FakeServer();
  const { store, raw } = await openTestStore({ newId: () => crypto.randomUUID() });
  const secrets = new MemorySecretStore();
  const network = new FakeNetworkMonitor(options.online ?? true);
  const scheduler = new ManualScheduler();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  let device: SyncDevice = { name: 'Test', platform: 'windows', extractionMode: 'self' };
  const progress: (PullProgress | null)[] = [];
  const engine = createSyncEngine({
    store,
    fetch: server.fetch,
    secrets,
    network,
    scheduler,
    device: async () => device,
    onPullProgress: (value) => progress.push(value),
    ...(options.pullPageSize ? { pullPageSize: options.pullPageSize } : {}),
  });
  return {
    server,
    store,
    raw,
    network,
    scheduler,
    engine,
    progress,
    setDevice(next: SyncDevice) {
      device = next;
    },
    status: () => loadSyncStatus(store),
    addTask: (title: string) => store.write((tx) => store.repos.tasks.create(tx, { title })),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Rows written on another device, for the server to hand out. */
async function rowsFromAnotherDevice(count: number): Promise<Change[]> {
  const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
  const changes: Change[] = [];
  for (let n = 1; n <= count; n += 1) {
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: `Task ${n}` }));
    changes.push({ table: 'tasks', row: task });
  }
  return changes;
}

const taskTitles = async ({ store }: Setup) =>
  (await store.db.query.tasks.findMany()).map((task) => task.title).sort();

describe('a sync', () => {
  it('registers, pushes and pulls, and registers only once', async () => {
    const device = await setup();
    await device.addTask('Buy milk');

    await device.engine.syncNow();
    await device.engine.syncNow();

    expect(device.server.count('/v1/devices/register')).toBe(1);
    expect(device.server.received.map(({ row }) => row.title)).toContain('Buy milk');
    expect(await device.store.sync.listOutbox()).toEqual([]);
    expect(await device.status()).toMatchObject({ state: 'synced', stuck: 0, clockSkew: false });
  });

  it('registers again when the device settings change', async () => {
    const device = await setup();
    await device.engine.syncNow();

    device.setDevice({ name: 'Test', platform: 'windows', extractionMode: 'delegate' });
    await device.engine.syncNow();

    const registrations = device.server.calls.filter((c) => c.path === '/v1/devices/register');
    expect(registrations.map((c) => (c.body as SyncDevice).extractionMode)).toEqual([
      'self',
      'delegate',
    ]);
  });

  it('registers again after the server forgets the device', async () => {
    const device = await setup();
    await device.engine.syncNow();
    await device.addTask('Buy milk');
    device.server.next('/v1/sync/push', failure(403, 'unknown_device'));

    await device.engine.syncNow();
    expect(await device.status()).toMatchObject({ state: 'failed' });
    expect(await device.store.sync.getState('registration')).toBe('');

    await device.engine.syncNow();
    expect(device.server.count('/v1/devices/register')).toBe(2);
    expect(await device.status()).toMatchObject({ state: 'synced' });
    expect(await device.store.sync.listOutbox()).toEqual([]);
  });

  it('stops on a wrong token and does not retry until asked', async () => {
    const device = await setup();
    device.server.next('/v1/devices/register', failure(401, 'unauthorized'));

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'unauthorized' });
    // No backoff retry was scheduled: a wrong token needs the user, not another try.
    expect(device.scheduler.pending).toBe(0);
  });

  it('does nothing while offline, and syncs as soon as the network is back', async () => {
    const device = await setup({ online: false });
    device.engine.start();
    await vi.waitFor(async () => expect((await device.status()).state).toBe('offline'));
    expect(device.server.calls).toEqual([]);

    device.network.setOnline(true);

    await vi.waitFor(async () => expect((await device.status()).state).toBe('synced'));
    device.engine.stop();
  });

  it('backs off while the server is down, and tries again at once on reconnect', async () => {
    const device = await setup();
    device.server.down = true;
    device.engine.start();
    await vi.waitFor(async () => expect((await device.status()).state).toBe('server_unreachable'));
    expect(device.server.count('/v1/health')).toBe(1);

    // The first retry comes within 2 s (1–2 s with jitter), not at the 30 s poll.
    device.scheduler.advance(2_000);
    await vi.waitFor(() => expect(device.server.count('/v1/health')).toBe(2));
    // A poll during the backoff doesn't get round it: the second retry waits 2–4 s.
    device.scheduler.advance(999);
    expect(device.server.count('/v1/health')).toBe(2);

    device.server.down = false;
    device.network.setOnline(false);
    device.network.setOnline(true);

    await vi.waitFor(async () => expect((await device.status()).state).toBe('synced'));
    device.engine.stop();
    expect(device.scheduler.pending).toBe(0);
  });
});

describe('pushing', () => {
  it('keeps a refused row and marks it stuck after 10 refusals, then stops sending it', async () => {
    const device = await setup();
    const task = await device.addTask('Refused');
    device.server.refused.set(task.id, 'validation');

    for (let n = 0; n < 10; n += 1) await device.engine.syncNow();
    expect(await device.status()).toMatchObject({ state: 'synced', stuck: 1 });
    expect(device.server.pushed.get(task.id)).toBe(10);

    await device.engine.syncNow();
    expect(device.server.pushed.get(task.id)).toBe(10);
  });

  it('reports a clock the server finds too far ahead', async () => {
    const device = await setup();
    const task = await device.addTask('From the future');
    device.server.refused.set(task.id, 'clock_skew');

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'synced', clockSkew: true });
  });

  it('sends a backlog bigger than one batch, and the rows after a refused one', async () => {
    const device = await setup();
    const first = await device.addTask('Refused');
    device.server.refused.set(first.id, 'validation');
    await device.store.write(async (tx) => {
      for (let n = 1; n <= 520; n += 1)
        await device.store.repos.tasks.create(tx, { title: `${n}` });
    });

    await device.engine.syncNow();

    // One walk through the outbox: two batches, and the refused row went once.
    expect(device.server.count('/v1/sync/push')).toBe(2);
    expect(device.server.received.filter(({ table }) => table === 'tasks')).toHaveLength(520);
    expect(await device.store.sync.listOutbox()).toHaveLength(1);
    expect(device.server.pushed.get(first.id)).toBe(1);
  });

  it('tries a refused row once per sync, however long the backlog', async () => {
    const device = await setup();
    const first = await device.addTask('Refused for now');
    device.server.refused.set(first.id, 'clock_skew');
    await device.store.write(async (tx) => {
      for (let n = 1; n <= 5_200; n += 1)
        await device.store.repos.tasks.create(tx, { title: `${n}` });
    });

    await device.engine.syncNow();
    expect(device.server.pushed.get(first.id)).toBe(1);
    expect(await device.status()).toMatchObject({ stuck: 0, clockSkew: true });

    device.server.refused.delete(first.id);
    await device.engine.syncNow();
    expect(await device.store.sync.listOutbox()).toEqual([]);
  }, 20_000);
});

describe('pulling', () => {
  it('pulls every page, and says how far a long download has got', async () => {
    const device = await setup({ pullPageSize: 2 });
    device.server.log.push(...(await rowsFromAnotherDevice(5)));

    await device.engine.syncNow();

    expect(await taskTitles(device)).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5']);
    expect(device.progress).toEqual([{ done: 2, total: 5 }, { done: 4, total: 5 }, null]);
    expect(await device.store.sync.getState('refill_cursor')).toBe('');
  });

  it('keeps what a broken full download got, and goes on from there', async () => {
    const device = await setup({ pullPageSize: 2 });
    device.server.log.push(...(await rowsFromAnotherDevice(5)));
    device.server.next('/v1/sync/pull', 'pass');
    device.server.next('/v1/sync/pull', failure(500, 'server_error'));

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'failed' });
    expect(await taskTitles(device)).toEqual(['Task 1', 'Task 2']);
    expect(await device.store.sync.getState('refill_cursor')).toBe('2');
    expect(device.progress.at(-1)).toBeNull();

    await device.engine.syncNow();

    const cursors = device.server.calls
      .filter((call) => call.path === '/v1/sync/pull')
      .map((call) => call.query.get('cursor'));
    expect(cursors).toEqual(['0', '2', '2', '4']);
    expect(await taskTitles(device)).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5']);
    expect(await device.status()).toMatchObject({ state: 'synced' });
  });

  it('skips a table it does not know, and takes the rest of the page', async () => {
    const device = await setup();
    const [first, second] = await rowsFromAnotherDevice(2);
    device.server.log.push(first as Change, {
      table: 'future_things',
      row: { id: crypto.randomUUID() },
    });
    device.server.log.push(second as Change);

    await device.engine.syncNow();

    expect(await taskTitles(device)).toEqual(['Task 1', 'Task 2']);
    expect(await device.status()).toMatchObject({ state: 'synced' });
  });

  // A newer device's values (ADR-0032): taken and passed on, read with a fallback here.
  it('takes a row with an enum value it does not know, and pushes it back unchanged', async () => {
    const device = await setup();
    const [task] = await rowsFromAnotherDevice(1);
    const fromANewerApp: Change['row'] = { ...(task as Change).row, origin: 'from_a_newer_app' };
    device.server.log.push({ table: 'tasks', row: fromANewerApp });

    await device.engine.syncNow();
    expect(await device.status()).toMatchObject({ state: 'synced', setAside: 0 });
    await device.store.write((tx) =>
      device.store.repos.tasks.editByUser(tx, String(fromANewerApp.id), { title: 'Renamed' }),
    );
    await device.engine.syncNow();

    const pushed = device.server.received.find(({ row }) => row.id === fromANewerApp.id);
    expect(pushed?.row).toMatchObject({ title: 'Renamed', origin: 'from_a_newer_app' });
  });

  it('keeps a routine whose repeat rule it cannot read, and makes no days for it', async () => {
    const device = await setup();
    const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
    const rule: RepeatRule = { freq: 'weekly', start: '2026-11-16', byWeekday: ['monday'] };
    const [readable, newer] = await store.write(async (tx) => [
      await store.repos.routines.create(tx, { title: 'Read', kind: 'confirm', repeatRule: rule }),
      await store.repos.routines.create(tx, { title: 'Newer', kind: 'confirm', repeatRule: rule }),
    ]);
    device.server.log.push(
      { table: 'routines', row: readable as Change['row'] },
      { table: 'routines', row: { ...newer, repeatRule: { ...rule, bySetPos: [1] } } },
    );

    await device.engine.syncNow();
    const made = await device.store.write((tx) =>
      device.store.repos.routines.ensureDays(tx, '2026-11-16'),
    );

    expect(await device.store.repos.routines.list(device.store.db)).toHaveLength(2);
    expect(made.map((day) => day.routineId)).toEqual([readable?.id]);
  });

  it('sets aside a row it cannot read, takes the rest of the page, and says so', async () => {
    const device = await setup();
    const [first, broken, third] = await rowsFromAnotherDevice(3);
    device.server.log.push(
      first as Change,
      { table: 'tasks', row: { ...(broken as Change).row, updatedAt: 'yesterday' } },
      third as Change,
    );

    await device.engine.syncNow();

    expect(await taskTitles(device)).toEqual(['Task 1', 'Task 3']);
    expect(await device.store.sync.getState('pull_cursor')).toBe('3');
    expect(await device.status()).toMatchObject({ state: 'synced', setAside: 1 });
  });

  it('drops a set-aside row when a readable version of it arrives', async () => {
    const device = await setup();
    const [task] = await rowsFromAnotherDevice(1);
    device.server.log.push({ table: 'tasks', row: { ...(task as Change).row, id: 'not-a-uuid' } });
    device.server.log.push({
      table: 'tasks',
      row: { ...(task as Change).row, updatedAt: 'later' },
    });
    await device.engine.syncNow();
    expect(await device.status()).toMatchObject({ setAside: 2 });

    device.server.log.push(task as Change);
    await device.engine.syncNow();

    expect(await taskTitles(device)).toEqual(['Task 1']);
    // The row with the bad ID has no readable version yet, so it stays aside.
    expect(await device.status()).toMatchObject({ state: 'synced', setAside: 1 });
  });

  it('applies a set-aside row once it can read it, as after an update', async () => {
    const device = await setup();
    const [task] = await rowsFromAnotherDevice(1);
    // Set aside by an older version of this app, which couldn't read it.
    await device.store.sync.applyPage([], 0, {
      setAside: [
        { table: 'tasks', id: String((task as Change).row.id), row: (task as Change).row },
      ],
    });

    await device.engine.syncNow();

    expect(await taskTitles(device)).toEqual(['Task 1']);
    expect(await device.status()).toMatchObject({ state: 'synced', setAside: 0 });
  });
});

describe('the server a device expects', () => {
  const OTHER = '0192a000-0000-7000-8000-00000000cccc';
  const HOME = 'https://hub.test';

  it('skips another machine at the home address and reaches its hub at the next one', async () => {
    const device = await setup();
    await saveConnection(device.store, new MemorySecretStore(), {
      urls: ['http://192.168.1.5:8787', HOME],
      token: TOKEN,
      trustLocalNetwork: true,
      serverId: SERVER_ID,
    });
    device.server.strangers.set('192.168.1.5:8787', OTHER);

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'synced' });
    const atCafe = device.server.calls.filter((call) => call.host === '192.168.1.5:8787');
    expect(atCafe.map((call) => [call.path, call.token])).toEqual([['/v1/health', null]]);
  });

  it('sends nothing to a different server at a saved address, and says to pair again', async () => {
    const device = await setup();
    await device.engine.syncNow();
    await device.addTask('Private plans');
    device.server.calls.length = 0;
    device.server.serverId = OTHER;

    await device.engine.syncNow();

    expect(device.server.calls.map((call) => [call.path, call.token])).toEqual([
      ['/v1/health', null],
    ]);
    expect(await device.status()).toMatchObject({
      state: 'wrong_server',
      errorCode: 'wrong_server',
    });
    expect(describeSync(await device.status())).toEqual({
      text: 'A different server answered at this address. Pair again.',
      helpCode: 'wrong_server',
    });
    expect(await device.store.sync.listOutbox()).toHaveLength(1);
  });

  it('expects the server it last synced with, on a device from before this was kept', async () => {
    const device = await setup();
    await device.engine.syncNow();
    device.raw.prepare("DELETE FROM sync_state WHERE key = 'expected_server_id'").run();
    device.server.serverId = OTHER;

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'wrong_server' });
  });

  it('expects the server a pairing code names, from the first sync', async () => {
    const device = await setup();
    await saveConnection(device.store, new MemorySecretStore(), {
      urls: [HOME],
      token: TOKEN,
      trustLocalNetwork: false,
      serverId: OTHER,
    });

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'wrong_server' });
    expect(device.server.count('/v1/devices/register')).toBe(0);
  });

  it('moves to the server at newly typed addresses, and sends it every row', async () => {
    const device = await setup();
    await device.addTask('Kept');
    await device.engine.syncNow();
    device.server.serverId = OTHER;
    device.server.received.length = 0;
    await saveConnection(device.store, new MemorySecretStore(), {
      urls: ['https://new-hub.test'],
      token: TOKEN,
      trustLocalNetwork: false,
    });

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'synced' });
    expect(device.server.received.map(({ row }) => row.title)).toContain('Kept');
    expect(await device.store.sync.getState('expected_server_id')).toBe(OTHER);
    expect(device.server.count('/v1/devices/register')).toBe(2);
  });

  it('keeps expecting its server when the same addresses are saved again', async () => {
    const device = await setup();
    await device.engine.syncNow();
    await saveConnection(device.store, new MemorySecretStore(), {
      urls: [HOME],
      token: 'a-new-token-that-is-long-enough-to-pass-32',
      trustLocalNetwork: false,
    });
    device.server.serverId = OTHER;

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'wrong_server' });
  });

  it('carries on with a restored server, sending every row again', async () => {
    const device = await setup();
    await device.addTask('Kept');
    await device.engine.syncNow();
    device.server.dataEpoch = '0192a000-0000-7000-8000-00000000dddd';
    device.server.received.length = 0;

    await device.engine.syncNow();

    expect(await device.status()).toMatchObject({ state: 'synced' });
    expect(device.server.received.map(({ row }) => row.title)).toContain('Kept');
  });
});

describe('the sync status', () => {
  it('keeps why the last sync failed, and forgets it once one succeeds', async () => {
    const device = await setup();
    device.server.next('/v1/devices/register', failure(500, 'rate_limited'));

    await device.engine.syncNow();
    const failed = await device.status();
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'rate_limited' });
    expect(describeSync(failed).helpCode).toBe('rate_limited');

    await device.engine.syncNow();
    expect(await device.status()).toMatchObject({ state: 'synced', errorCode: null });
  });

  it('reads a saved status that was cut short as no status', async () => {
    const device = await setup();
    await device.store.sync.setState('status', '{"state":"syn');

    expect(await device.status()).toEqual(INITIAL_STATUS);
  });
});
