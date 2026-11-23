import { runWrite } from '@avchetan/core';
import { devices, PG_SYNCED_TABLES, tasks as serverTasks } from '@avchetan/db/pg';
import { type ClientStore, changedFields, SYNCED_TABLES, type Task } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { createSyncEngine, type SyncEngine, saveConnection } from '@avchetan/sync';
import { eq, getTableName, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import type { ServerDatabase } from './db/client';
import { openTestDatabase } from './db/testing';

/**
 * Randomized convergence (ADR-0034): random hand edits, deletes, clock steps and syncs on two or
 * three devices must always end with identical data, and each device must show a conflict exactly
 * when its last hand edit lost to another device's while it was still waiting to be sent.
 */

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const URL = 'https://hub.test';
const START = '2026-10-26T10:00:00.000Z';
/** Fixed, so a failure can be replayed; fast-check prints the shrunk case. */
const SEED = 20261123;

let database: ServerDatabase | undefined;
let serverMs: number;
let serverFetch: HttpFetch;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

/**
 * A fresh server for each run, over one database emptied between runs (starting Postgres for
 * each run took minutes): the server allows only so many devices, and each run pairs new ones.
 */
async function startServer(): Promise<ServerDatabase> {
  serverMs = Date.parse(START);
  if (!database) {
    database = await openTestDatabase();
    await database.migrate(() => new Date(serverMs).toISOString());
  }
  const db = database;
  const tables = [...Object.values(PG_SYNCED_TABLES).map(getTableName), getTableName(devices)];
  await db.db.execute(sql.raw(`truncate table ${tables.map((name) => `"${name}"`).join(', ')}`));
  const clock = createMonotonicClock({ source: () => serverMs });
  const identity = await loadServerIdentity(db.db, TOKEN);
  const app = createApp({
    db: db.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    nowMs: () => serverMs,
    pairing: { urls: () => [URL], tokenFromEnv: false },
    clientAddress: () => '127.0.0.1',
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
  return db;
}

type Sim = { store: ClientStore; engine: SyncEngine; advance: (ms: number) => void };

/** IDs from a counter per device and run: the same seed makes the same device IDs. */
function seededIds(run: number, deviceIndex: number) {
  let next = 0;
  return () => {
    next += 1;
    const tail = `${deviceIndex}${String(run).padStart(4, '0')}${String(next).padStart(7, '0')}`;
    return `0192a000-0000-7000-8000-${tail.slice(-12)}`;
  };
}

async function simDevice(run: number, index: number): Promise<Sim> {
  const { store, advance } = await openTestStore({ start: START, newId: seededIds(run, index) });
  const secrets = new MemorySecretStore();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  const engine = createSyncEngine({
    store,
    fetch: (input, init) => serverFetch(input, init),
    secrets,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    device: { name: 'Test', platform: 'android', extractionMode: 'self' },
  });
  return { store, engine, advance };
}

type Op =
  | { kind: 'title'; device: number; title: string }
  | { kind: 'done'; device: number; done: boolean }
  | { kind: 'delete'; device: number }
  | { kind: 'tick'; device: number; ms: number }
  | { kind: 'sync'; device: number };

function opArb(devices: number): fc.Arbitrary<Op> {
  const device = fc.integer({ min: 0, max: devices - 1 });
  const title = fc.record({
    kind: fc.constant('title' as const),
    device,
    title: fc.constantFrom('a', 'b', 'c'),
  });
  const done = fc.record({ kind: fc.constant('done' as const), device, done: fc.boolean() });
  const remove = fc.record({ kind: fc.constant('delete' as const), device });
  const tick = fc.record({
    kind: fc.constant('tick' as const),
    device,
    ms: fc.integer({ min: 1, max: 3_000 }),
  });
  const sync = fc.record({ kind: fc.constant('sync' as const), device });
  return fc.oneof(
    { weight: 4, arbitrary: title },
    { weight: 2, arbitrary: done },
    { weight: 1, arbitrary: remove },
    { weight: 2, arbitrary: tick },
    { weight: 3, arbitrary: sync },
  );
}

const versionOf = (row: Pick<Task, 'updatedAt' | 'updatedByDevice'>) =>
  `${row.updatedAt}|${row.updatedByDevice}`;

async function readTask({ store }: Sim, id: string): Promise<Task> {
  const row = await store.db.query.tasks.findFirst({ where: (t, { eq: is }) => is(t.id, id) });
  if (!row) throw new Error('task missing');
  return row;
}

/** The server's version of the task, in the clients' ISO form. */
async function serverVersion(server: ServerDatabase, id: string): Promise<string | null> {
  const [row] = await server.db
    .select({
      updatedAt: sql<string>`to_char(${serverTasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      updatedByDevice: serverTasks.updatedByDevice,
    })
    .from(serverTasks)
    .where(eq(serverTasks.id, id));
  return row ? versionOf(row) : null;
}

async function syncedTables({ store }: Sim) {
  const entries = await Promise.all(
    Object.entries(SYNCED_TABLES).map(async ([name, table]) => {
      const rows = (await store.db.select().from(table)) as { id: string }[];
      return [name, rows.sort((a, b) => a.id.localeCompare(b.id))] as const;
    }),
  );
  return Object.fromEntries(entries);
}

const scenario = fc
  .integer({ min: 2, max: 3 })
  .chain((count) =>
    fc.tuple(fc.constant(count), fc.array(opArb(count), { minLength: 1, maxLength: 14 })),
  );

let run = 0;

async function check([count, ops]: [number, Op[]]): Promise<void> {
  run += 1;
  const server = await startServer();
  const devices: Sim[] = [];
  for (let index = 0; index < count; index++) devices.push(await simDevice(run, index));
  const first = devices[0] as Sim;
  const task = await first.store.write((tx) =>
    first.store.repos.tasks.create(tx, { title: 'start' }),
  );
  for (let round = 0; round < 2; round++) {
    for (const each of devices) await each.engine.syncNow();
  }

  /** Each hand edit by its version: the version it was made on, and the row it made. */
  const edits = new Map<string, { base: string; row: Task }>();
  const lastEdit = new Map<number, string>();
  /** Versions the server has held: an edit it took was not lost while waiting. */
  const accepted = new Set<string>();
  const sync = async (index: number) => {
    await (devices[index] as Sim).engine.syncNow();
    const stored = await serverVersion(server, task.id);
    if (stored) accepted.add(stored);
  };

  for (const op of ops) {
    const sim = devices[op.device] as Sim;
    if (op.kind === 'sync') {
      await sync(op.device);
      continue;
    }
    if (op.kind === 'tick') {
      sim.advance(op.ms);
      serverMs += op.ms;
      continue;
    }
    const before = await readTask(sim, task.id);
    // The apps offer no edits on a deleted task.
    if (before.deletedAt) continue;
    const context = {
      store: sim.store,
      today: () => '2026-10-26',
      textSource: 'mobile_text' as const,
    };
    if (op.kind === 'title') {
      await runWrite(context, 'task.edit', { id: task.id, title: op.title });
    } else if (op.kind === 'done') {
      await runWrite(context, 'task.setDone', { id: task.id, done: op.done });
    } else {
      await runWrite(context, 'task.delete', { id: task.id });
    }
    const after = await readTask(sim, task.id);
    edits.set(versionOf(after), { base: versionOf(before), row: after });
    lastEdit.set(op.device, versionOf(after));
  }
  for (let round = 0; round < 2; round++) {
    for (let index = 0; index < count; index++) await sync(index);
  }

  // Everyone ends with the same data.
  const tables = await Promise.all(devices.map(syncedTables));
  for (const other of tables.slice(1)) expect(other).toEqual(tables[0]);

  // A conflict exactly where a device's last hand edit lost while still waiting.
  const final = await readTask(first, task.id);
  const lineage = new Set<string>();
  for (let at: string | undefined = versionOf(final); at && !lineage.has(at); ) {
    lineage.add(at);
    at = edits.get(at)?.base;
  }
  for (let index = 0; index < count; index++) {
    const mine = lastEdit.get(index);
    const edit = mine === undefined ? undefined : edits.get(mine);
    const lost = mine !== undefined && !lineage.has(mine) && !accepted.has(mine);
    const differs =
      edit !== undefined && changedFields('tasks', edit.row as never, final as never).length > 0;
    const shown = (await (devices[index] as Sim).store.conflicts()).map((c) => c.id);
    expect(shown, `device ${index}`).toEqual(lost && differs ? [task.id] : []);
  }
}

describe('edits on several devices, at random', () => {
  it('always converge, and every hand edit that lost while waiting is kept', async () => {
    await fc.assert(fc.asyncProperty(scenario, check), { seed: SEED, numRuns: 30 });
  }, 300_000);
});
