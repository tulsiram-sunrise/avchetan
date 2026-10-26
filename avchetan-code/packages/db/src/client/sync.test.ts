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
