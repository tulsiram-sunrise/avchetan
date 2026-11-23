import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  isSharedCommand,
  planSharedCommand,
  rememberCapture,
  type SharedCommandDeps,
  type SyncOutcome,
} from './handlers';
import { createUndoStack, MAX_UNDO } from './undo';

async function setup(syncState: SyncOutcome = 'synced') {
  const { store } = await openTestStore();
  const deps: SharedCommandDeps = {
    write: { store, today: () => '2026-11-07', textSource: 'mobile_text' },
    words: { device: 'phone', syncPlace: 'More → Sync' },
    today: () => '2026-11-07',
    makeBrief: vi.fn(async () => 'made' as const),
    syncNow: vi.fn(async () => syncState),
    openDays: vi.fn(async () => {}),
    openSearch: vi.fn(async () => {}),
    changed: vi.fn(),
    undo: createUndoStack(),
  };
  return { store, deps };
}

async function run(plan: ReturnType<typeof planSharedCommand>) {
  if (plan.kind !== 'run') throw new Error(`expected a run plan, got ${plan.kind}`);
  return plan.run();
}

describe('shared commands', () => {
  it('leaves settings, lock and unlock to each app', () => {
    expect(
      ['done', 'find', 'brief', 'sync', 'undo'].every((name) => isSharedCommand(name as never)),
    ).toBe(true);
    expect(isSharedCommand('settings')).toBe(false);
    expect(isSharedCommand('lock')).toBe(false);
  });

  it('marks a task done, and /undo reopens it', async () => {
    const { store, deps } = await setup();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    const open = await store.queries.openTasks(store.db);

    const done = await run(planSharedCommand(deps, 'done', 'milk', open));
    expect(done.message).toBe('Done: Buy milk');
    expect(await store.queries.openTasks(store.db)).toEqual([]);

    const undo = planSharedCommand(deps, 'undo', '', []);
    expect(undo).toMatchObject({ kind: 'run', label: 'Undo: reopen “Buy milk”' });
    expect((await run(undo)).message).toBe('Reopened: Buy milk');
    expect((await store.queries.openTasks(store.db)).map((t) => t.id)).toEqual([task.id]);
    expect(deps.changed).toHaveBeenCalledTimes(2);
  });

  it('takes back an entry saved from the capture box', async () => {
    const { store, deps } = await setup();
    const rawLog = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'Bought   milk and bread and eggs and butter and cheese',
        source: 'mobile_text',
        capturedTz: 'UTC',
        explicitTagPaths: [],
      }),
    );
    rememberCapture(deps, rawLog);

    const undo = planSharedCommand(deps, 'undo', '', []);
    // Spaces folded, cut at 40 characters.
    expect(undo).toMatchObject({
      label: 'Undo: delete “Bought milk and bread and eggs and butte…”',
    });
    await run(undo);

    const gone = await store.db.query.rawLogs.findFirst({
      where: (logs, { eq }) => eq(logs.id, rawLog.id),
    });
    expect(gone?.deletedAt).not.toBeNull();
    expect(planSharedCommand(deps, 'undo', '', [])).toMatchObject({ kind: 'hint' });
  });

  it.each([
    ['synced', 'Synced'],
    ['offline', 'This phone is offline; it syncs when it’s back'],
    ['failed', 'Sync failed; More → Sync says why'],
  ] as const)('says how a sync ended: %s', async (state, message) => {
    const { deps } = await setup(state);

    expect((await run(planSharedCommand(deps, 'sync', '', []))).message).toBe(message);
  });
});

describe('undo stack', () => {
  it(`keeps the newest ${MAX_UNDO}`, () => {
    const stack = createUndoStack();
    for (let i = 0; i <= MAX_UNDO; i++) {
      stack.push({ label: String(i), undo: async () => String(i) });
    }

    expect(stack.size).toBe(MAX_UNDO);
    expect(stack.peek()?.label).toBe(String(MAX_UNDO));
  });

  it('keeps an undo that failed, to try again', async () => {
    const stack = createUndoStack();
    const entry = {
      label: 'x',
      undo: vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue('Undone'),
    };
    stack.push(entry);

    await expect(stack.run(entry)).rejects.toThrow('busy');
    expect(stack.size).toBe(1);
    await expect(stack.run(entry)).resolves.toBe('Undone');
    await expect(stack.run(entry)).resolves.toBeUndefined();
  });
});
