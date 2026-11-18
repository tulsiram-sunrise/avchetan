import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import type { RemoteChange } from './apply-remote';
import type { ReadRow } from './set-aside';

async function taskRow(title: string) {
  const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
  return store.write((tx) => store.repos.tasks.create(tx, { title }));
}

/** Reads a task row only once its title is not "unreadable", like a newer app would. */
const read: ReadRow = ({ table, row }) =>
  table === 'tasks' && (row as { title: string }).title !== 'unreadable'
    ? ({ table, row } as RemoteChange)
    : null;

describe('rows set aside (ADR-0032)', () => {
  it('keeps them across syncs, and applies only those it can read now', async () => {
    const { store } = await openTestStore();
    const now = await taskRow('Pay rent');
    const later = { ...(await taskRow('x')), title: 'unreadable' };
    await store.sync.applyPage([], 1, {
      setAside: [
        { table: 'tasks', id: now.id, row: now },
        { table: 'tasks', id: later.id, row: later },
      ],
    });
    expect(await store.sync.setAsideCount()).toBe(2);

    expect(await store.sync.retrySetAside(read)).toBe(1);

    const titles = (await store.db.query.tasks.findMany()).map((task) => task.title);
    expect(titles).toEqual(['Pay rent']);
    expect(await store.sync.setAsideCount()).toBe(1);
    expect(await store.sync.retrySetAside(read)).toBe(0);
  });

  it('keeps one copy per row, the latest', async () => {
    const { store } = await openTestStore();
    const row = await taskRow('Pay rent');
    for (const title of ['first', 'second']) {
      await store.sync.applyPage([], 1, {
        setAside: [{ table: 'tasks', id: row.id, row: { ...row, title } }],
      });
    }

    expect(await store.sync.setAsideCount()).toBe(1);
    await store.sync.retrySetAside(read);
    expect((await store.db.query.tasks.findMany()).map((task) => task.title)).toEqual(['second']);
  });
});
