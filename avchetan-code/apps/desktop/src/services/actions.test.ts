import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ActionBus,
  type ActionClient,
  type ActionRequest,
  type ActionResult,
  createActionClient,
  serveActions,
} from './actions';

function memoryBus(): ActionBus {
  let onRequest: (request: ActionRequest) => void = () => {};
  let onResult: (result: ActionResult) => void = () => {};
  return {
    sendRequest: async (request) => onRequest(request),
    sendResult: async (result) => onResult(result),
    onRequest: async (handler) => {
      onRequest = handler;
      return () => {};
    },
    onResult: async (handler) => {
      onResult = handler;
      return () => {};
    },
  };
}

let store: ClientStore;
let actions: ActionClient;
const onDone = vi.fn();

beforeEach(async () => {
  onDone.mockReset();
  ({ store } = await openTestStore());
  const bus = memoryBus();
  await serveActions(store, bus, onDone);
  actions = createActionClient(bus);
});

const newTask = (title = 'Call the plumber') =>
  store.write((tx) => store.repos.tasks.create(tx, { title }));

describe('actions', () => {
  it('runs a write in the serving window and reports back', async () => {
    const task = await newTask();

    await actions.run('task.setDone', { id: task.id, done: true });

    expect((await store.queries.openTasks(store.db)).length).toBe(0);
    expect(await store.queries.completedTasks(store.db)).toMatchObject([{ id: task.id }]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('reopens a task', async () => {
    const task = await newTask();
    await actions.run('task.setDone', { id: task.id, done: true });

    await actions.run('task.setDone', { id: task.id, done: false });

    expect(await store.queries.openTasks(store.db)).toMatchObject([{ id: task.id }]);
  });

  it('edits only the fields it was given', async () => {
    const task = await newTask();

    await actions.run('task.edit', { id: task.id, dueDate: '2026-11-02' });

    expect(await store.queries.openTasks(store.db)).toMatchObject([
      { title: 'Call the plumber', dueDate: '2026-11-02' },
    ]);
  });

  it('can clear a due date', async () => {
    const task = await newTask();
    await actions.run('task.edit', { id: task.id, dueDate: '2026-11-02' });

    await actions.run('task.edit', { id: task.id, dueDate: null });

    expect((await store.queries.openTasks(store.db))[0]?.dueDate).toBeNull();
  });

  it('passes a validation failure back with its code', async () => {
    const task = await newTask();

    await expect(actions.run('task.edit', { id: task.id, title: '   ' })).rejects.toMatchObject({
      code: 'invalid_title',
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('rejects malformed arguments', async () => {
    await expect(actions.run('task.delete', { id: '' })).rejects.toThrow();
  });

  it('rejects an unknown action', async () => {
    const run = actions.run as (name: string, args: unknown) => Promise<void>;
    await expect(run('nothing.here', {})).rejects.toMatchObject({ code: 'unknown_action' });
  });

  it('edits an entry by replacing it, keeping explicit tags and its capture time', async () => {
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'first',
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
      }),
    );

    await actions.run('log.editContent', { id: log.id, content: 'better #fitness' });

    const [next] = await store.queries.recentRawLogs(store.db, { limit: 5 });
    expect(next).toMatchObject({
      content: 'better #fitness',
      capturedAt: log.capturedAt,
      capturedTz: 'Asia/Kolkata',
    });
    const tags = await store.repos.tags.forTarget(store.db, 'raw_log', next?.id as string);
    expect(tags.map((tag) => tag.path)).toEqual(['fitness']);
  });

  it('fails clearly when nobody answers', async () => {
    const silent: ActionBus = { ...memoryBus(), sendRequest: async () => {} };
    const client = createActionClient(silent, 5);

    await expect(client.run('task.delete', { id: 'a' })).rejects.toMatchObject({
      code: 'dock_unavailable',
    });
  });
});
