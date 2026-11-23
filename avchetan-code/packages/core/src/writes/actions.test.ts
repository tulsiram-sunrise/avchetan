import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { isWriteName, runWrite, type WriteContext } from './actions';

async function setup(textSource: WriteContext['textSource'] = 'mobile_text') {
  const { store } = await openTestStore();
  const context: WriteContext = { store, today: () => '2026-11-07', textSource };
  return { store, context };
}

describe('runWrite', () => {
  it('refuses a write it doesn’t know, as a newer window might ask for', async () => {
    const { context } = await setup();

    expect(isWriteName('task.teleport')).toBe(false);
    await expect(runWrite(context, 'task.teleport', {})).rejects.toMatchObject({
      code: 'unknown_action',
    });
  });

  it('checks the arguments before writing', async () => {
    const { store, context } = await setup();

    await expect(runWrite(context, 'task.cancel', { id: '' })).rejects.toThrow();
    expect(await store.queries.openTasks(store.db)).toEqual([]);
  });

  it('finishes a task, and reopens it', async () => {
    const { store, context } = await setup();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Call Asha' }));

    await runWrite(context, 'task.setDone', { id: task.id, done: true });
    const done = await store.db.query.tasks.findFirst({
      where: (tasks, { eq }) => eq(tasks.id, task.id),
    });
    expect(done?.completedAt).not.toBeNull();

    await runWrite(context, 'task.setDone', { id: task.id, done: false });
    expect((await store.queries.openTasks(store.db)).map((open) => open.id)).toEqual([task.id]);
  });

  it('saves an edited entry again from this device, returning the new entry', async () => {
    const { store, context } = await setup('desktop_text');
    const old = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'ran 5k',
        source: 'mobile_text',
        capturedTz: 'UTC',
        explicitTagPaths: [],
      }),
    );

    const next = await runWrite(context, 'log.editContent', { id: old.id, content: 'ran 6k' });

    expect(next).toMatchObject({ content: 'ran 6k', source: 'desktop_text' });
  });
});
