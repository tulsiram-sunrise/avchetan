import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import type { RemoteChange } from './apply-remote';
import { compareVersions } from './lww';
import { seedCategoryId } from './repos/categories';
import type { ClientStore } from './store';
import { getById, SYNCED_TABLES } from './synced';

type TestStore = Awaited<ReturnType<typeof openTestStore>>;

/** Two devices with distinct IDs and wall clocks. */
async function twoDevices() {
  const a = await openTestStore({ newId: () => crypto.randomUUID() });
  const b = await openTestStore({ newId: () => crypto.randomUUID() });
  return { a, b };
}

/** Pretend-sync: push a's outbox rows straight into b (what the server round trip does). */
async function deliver(from: ClientStore, to: ClientStore) {
  const entries = await from.sync.listOutbox();
  const changes: RemoteChange[] = [];
  for (const entry of entries) {
    const row = await getById(from.db, SYNCED_TABLES[entry.tableName], entry.recordId);
    if (row) changes.push({ table: entry.tableName, row } as RemoteChange);
  }
  const result = await to.sync.applyRemote(changes);
  await from.sync.ackOutbox(entries);
  return result;
}

const snapshot = async ({ store }: TestStore) => ({
  logs: await store.db.query.rawLogs.findMany({ orderBy: (t, { asc }) => asc(t.id) }),
  tasks: await store.db.query.tasks.findMany({ orderBy: (t, { asc }) => asc(t.id) }),
  tags: await store.db.query.tags.findMany({ orderBy: (t, { asc }) => asc(t.id) }),
  links: await store.db.query.entityTags.findMany({ orderBy: (t, { asc }) => asc(t.id) }),
});

describe('compareVersions', () => {
  it('orders by updated_at, then device ID', () => {
    const v = (updatedAt: string, updatedByDevice: string) => ({ updatedAt, updatedByDevice });
    expect(
      compareVersions(v('2026-10-26T10:00:00.001Z', 'a'), v('2026-10-26T10:00:00.000Z', 'z')),
    ).toBe(1);
    expect(
      compareVersions(v('2026-10-26T10:00:00.000Z', 'b'), v('2026-10-26T10:00:00.000Z', 'a')),
    ).toBe(1);
    expect(
      compareVersions(v('2026-10-26T10:00:00.000Z', 'a'), v('2026-10-26T10:00:00.000Z', 'a')),
    ).toBe(0);
  });
});

describe('outbox', () => {
  it('coalesces repeated edits of one row into one pointer', async () => {
    const { store } = await openTestStore();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    for (const title of ['Buy oat milk', 'Buy milk + eggs', 'Buy groceries']) {
      await store.write((tx) => store.repos.tasks.editByUser(tx, task.id, { title }));
    }
    const pointers = (await store.sync.listOutbox()).filter((e) => e.recordId === task.id);
    expect(pointers).toHaveLength(1);
  });

  it('keeps a pointer that was re-enqueued while a push was in flight', async () => {
    const { store } = await openTestStore();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    const inFlight = (await store.sync.listOutbox()).filter((e) => e.recordId === task.id);
    await store.write((tx) => store.repos.tasks.complete(tx, task.id)); // edit during push
    expect(await store.sync.ackOutbox(inFlight)).toBe(0);
    expect((await store.sync.listOutbox()).some((e) => e.recordId === task.id)).toBe(true);
  });

  it('walks every pointer once in batches, even when they share one time', async () => {
    const { store } = await openTestStore();
    await store.write(async (tx) => {
      for (let n = 0; n < 25; n += 1) await store.repos.tasks.create(tx, { title: `Task ${n}` });
    });
    await store.sync.ackOutbox(await store.sync.listOutbox());
    // Queued again for a new server: every pointer gets the same enqueued_at.
    await store.sync.setStates({}, { requeue: true });
    const all = await store.sync.listOutbox();
    expect(new Set(all.map((entry) => entry.enqueuedAt)).size).toBe(1);

    const seen: string[] = [];
    let after: (typeof all)[number] | undefined;
    for (;;) {
      const batch = await store.sync.listOutbox(7, after);
      if (batch.length === 0) break;
      seen.push(...batch.map((entry) => `${entry.tableName}:${entry.recordId}`));
      after = batch.at(-1);
    }

    expect(seen).toEqual(all.map((entry) => `${entry.tableName}:${entry.recordId}`));
    expect(new Set(seen).size).toBe(all.length);
  });

  it('queues every row again, deleted ones too, for a new server', async () => {
    const { store } = await openTestStore();
    const kept = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    const gone = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Typo' }));
    await store.write((tx) => store.repos.tasks.softDelete(tx, gone.id));
    await store.sync.ackOutbox(await store.sync.listOutbox());
    expect(await store.sync.listOutbox()).toEqual([]);

    await store.sync.enqueueEverything();

    const ids = (await store.sync.listOutbox(1000)).map((entry) => entry.recordId);
    expect(ids).toEqual(expect.arrayContaining([kept.id, gone.id, seedCategoryId('work')]));
  });

  it('counts entries waiting to be sent, and when the oldest was queued', async () => {
    const { store } = await openTestStore();
    expect(await store.sync.waitingEntries()).toEqual({ count: 0, oldestAt: null });

    const capture = (content: string) =>
      store.write((tx) =>
        store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
      );
    await capture('walked to the station');
    await capture('read two chapters');
    // A task is waiting too, but only entries count.
    await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    const queued = (await store.sync.listOutbox()).filter((e) => e.tableName === 'raw_logs');

    const waiting = await store.sync.waitingEntries();
    expect(waiting.count).toBe(2);
    expect(waiting.oldestAt).toBe(queued[0]?.enqueuedAt);

    await store.sync.ackOutbox(queued);
    expect(await store.sync.waitingEntries()).toEqual({ count: 0, oldestAt: null });
  });
});

describe('applyRemoteChanges (LWW)', () => {
  it('converges two devices after offline captures on both', async () => {
    const { a, b } = await twoDevices();
    await a.store.write((tx) =>
      a.store.repos.rawLogs.capture(tx, {
        content: 'Ran #running',
        source: 'desktop_text',
        capturedTz: 'UTC',
        explicitTagPaths: ['running'],
      }),
    );
    await b.store.write((tx) =>
      b.store.repos.rawLogs.capture(tx, {
        content: 'Walked #running',
        source: 'mobile_text',
        capturedTz: 'UTC',
        explicitTagPaths: ['running'],
      }),
    );

    await deliver(a.store, b.store);
    await deliver(b.store, a.store);

    const [sa, sb] = [await snapshot(a), await snapshot(b)];
    expect(sa).toEqual(sb);
    expect(sa.logs).toHaveLength(2);
    // Both devices created #running offline: same derived ID → one tag, not two.
    expect(sa.tags).toHaveLength(1);
  });

  it('lets the newer edit win on both devices, regardless of delivery order', async () => {
    const { a, b } = await twoDevices();
    const task = await a.store.write((tx) => a.store.repos.tasks.create(tx, { title: 'Buy milk' }));
    await deliver(a.store, b.store);

    await a.store.write((tx) =>
      a.store.repos.tasks.editByUser(tx, task.id, { title: 'Older edit' }),
    );
    b.advance(60_000); // b edits later
    await b.store.write((tx) =>
      b.store.repos.tasks.editByUser(tx, task.id, { title: 'Newer edit' }),
    );

    // The older edit arrives first and is skipped; then the newer one wins.
    const toB = await deliver(a.store, b.store);
    const toA = await deliver(b.store, a.store);
    expect(toB.skipped).toBeGreaterThanOrEqual(1);
    expect(toA.applied).toBeGreaterThanOrEqual(1);

    const title = async (s: TestStore) =>
      (await getById(s.store.db, SYNCED_TABLES.tasks, task.id))?.title;
    expect(await title(a)).toBe('Newer edit');
    expect(await title(b)).toBe('Newer edit');
  });

  it('drops the local outbox pointer when a newer remote row wins', async () => {
    const { a, b } = await twoDevices();
    const task = await a.store.write((tx) => a.store.repos.tasks.create(tx, { title: 'x' }));
    await deliver(a.store, b.store);
    await a.store.write((tx) => a.store.repos.tasks.editByUser(tx, task.id, { title: 'from a' }));
    b.advance(60_000);
    await b.store.write((tx) => b.store.repos.tasks.editByUser(tx, task.id, { title: 'from b' }));

    await deliver(b.store, a.store);
    expect((await a.store.sync.listOutbox()).some((e) => e.recordId === task.id)).toBe(false);
  });

  it('propagates deletes as tombstones', async () => {
    const { a, b } = await twoDevices();
    const activity = await a.store.write((tx) =>
      a.store.repos.activities.create(tx, {
        categoryId: seedCategoryId('workout'),
        title: 'Run',
        loggedDate: '2026-10-26',
      }),
    );
    await deliver(a.store, b.store);
    await a.store.write((tx) => a.store.repos.activities.softDelete(tx, activity.id));
    await deliver(a.store, b.store);
    expect(await b.store.queries.activitiesOn(b.store.db, '2026-10-26')).toEqual([]);
  });

  it('does not enqueue the outbox when applying remote rows', async () => {
    const { a, b } = await twoDevices();
    const task = await a.store.write((tx) => a.store.repos.tasks.create(tx, { title: 'x' }));
    await deliver(a.store, b.store);
    expect(await getById(b.store.db, SYNCED_TABLES.tasks, task.id)).toBeDefined();
    expect((await b.store.sync.listOutbox()).some((e) => e.recordId === task.id)).toBe(false);
  });
});

describe('applying a large page', () => {
  /** Tasks made on device a, as the rows a pull would bring. */
  async function remoteTasks(count: number) {
    const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
    const tasks = await store.write(async (tx) => {
      const made = [];
      for (let i = 0; i < count; i += 1) {
        made.push(await store.repos.tasks.create(tx, { title: `Task ${i}` }));
      }
      return made;
    });
    return { store, tasks };
  }

  it('inserts more new rows than one statement holds', async () => {
    const { tasks } = await remoteTasks(450);
    const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
    const queued = (await store.sync.listOutbox()).length;
    const changes = tasks.map((row) => ({ table: 'tasks', row }) as RemoteChange);
    expect(await store.sync.applyRemote(changes)).toEqual({ applied: 450, skipped: 0 });
    const stored = await store.db.query.tasks.findMany();
    expect(stored).toHaveLength(450);
    expect(stored.find((task) => task.title === 'Task 449')).toBeDefined();
    // Pulled rows are never queued to be sent back.
    expect(await store.sync.listOutbox()).toHaveLength(queued);
  });

  it('mixes new, newer, older and a repeated id in one page', async () => {
    const { a, b } = await twoDevices();
    const [kept, replaced] = await b.store.write(async (tx) => [
      await b.store.repos.tasks.create(tx, { title: 'Kept here' }),
      await b.store.repos.tasks.create(tx, { title: 'Old here' }),
    ]);
    const newer = { ...replaced, title: 'Newer there', updatedAt: '2099-01-01T00:00:00.000Z' };
    const older = { ...kept, title: 'Older there', updatedAt: '2000-01-01T00:00:00.000Z' };
    const fresh = await a.store.write((tx) => a.store.repos.tasks.create(tx, { title: 'New' }));
    const freshLater = { ...fresh, title: 'New, edited', updatedAt: '2099-01-01T00:00:00.000Z' };
    const page = [newer, older, fresh, freshLater].map(
      (row) => ({ table: 'tasks', row }) as RemoteChange,
    );

    expect(await b.store.sync.applyRemote(page)).toEqual({ applied: 2, skipped: 2 });
    const title = async (id: string) => (await getById(b.store.db, SYNCED_TABLES.tasks, id))?.title;
    expect(await title(replaced.id)).toBe('Newer there');
    expect(await title(kept.id)).toBe('Kept here');
    expect(await title(fresh.id)).toBe('New, edited');
  });
});
