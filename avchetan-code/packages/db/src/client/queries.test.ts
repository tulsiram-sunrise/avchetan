import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';

const captureIn = (store: Awaited<ReturnType<typeof openTestStore>>['store'], content: string) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
  );

describe('recentRawLogs', () => {
  it('pages newest-first with a keyset cursor', async () => {
    const { store } = await openTestStore();
    for (const n of [1, 2, 3, 4, 5]) await captureIn(store, `log ${n}`);

    const page1 = await store.queries.recentRawLogs(store.db, { limit: 2 });
    expect(page1.map((l) => l.content)).toEqual(['log 5', 'log 4']);
    const last = page1.at(-1);
    const page2 = await store.queries.recentRawLogs(store.db, {
      limit: 2,
      ...(last ? { before: { capturedAt: last.capturedAt, id: last.id } } : {}),
    });
    expect(page2.map((l) => l.content)).toEqual(['log 3', 'log 2']);
  });
});

describe('openTasks', () => {
  it('lists dated tasks by due date, then undated, excluding completed', async () => {
    const { store } = await openTestStore();
    await store.write(async (tx) => {
      await store.repos.tasks.create(tx, { title: 'someday' });
      await store.repos.tasks.create(tx, { title: 'friday', dueDate: '2026-10-30' });
      await store.repos.tasks.create(tx, { title: 'tomorrow', dueDate: '2026-10-27' });
      const done = await store.repos.tasks.create(tx, { title: 'done', dueDate: '2026-10-26' });
      await store.repos.tasks.complete(tx, done.id);
    });
    const titles = (await store.queries.openTasks(store.db)).map((t) => t.title);
    expect(titles).toEqual(['tomorrow', 'friday', 'someday']);
  });
});

describe('claimablePendingLogs', () => {
  it('returns only own, pending, unleased logs within attempts and backoff', async () => {
    const { store } = await openTestStore();
    const now = '2026-10-26T12:00:00.000Z';
    const [ok, leased, exhausted, backingOff, done, foreign] = await Promise.all(
      ['ok', 'leased', 'exhausted', 'backing off', 'done', 'foreign'].map((c) =>
        captureIn(store, c),
      ),
    );
    const set = (id: string | undefined, sql: string) =>
      store.write((tx) => tx.run(`UPDATE raw_logs SET ${sql} WHERE id = '${id}'`));
    await set(leased?.id, "processing_lease_until = '2026-10-26T12:01:00.000Z'");
    await set(exhausted?.id, 'processing_attempts = 3');
    await set(backingOff?.id, "next_attempt_at = '2026-10-26T12:05:00.000Z'");
    await set(done?.id, "status = 'processed'");
    await set(foreign?.id, "origin_device_id = 'another-device'");

    const claimable = await store.queries.claimablePendingLogs(store.db, {
      deviceId: store.deviceId,
      now,
      maxAttempts: 3,
      limit: 10,
    });
    expect(claimable.map((l) => l.id)).toEqual([ok?.id]);
    expect(await store.queries.pendingCount(store.db)).toBe(5);
  });
});
