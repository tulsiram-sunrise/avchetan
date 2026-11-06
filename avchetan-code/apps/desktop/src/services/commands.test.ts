import { parseCommand } from '@avchetan/core';
import { type ClientStore, listOutbox, type Task } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CommandDeps,
  type CommandOutcome,
  type CommandPlan,
  createUndoStack,
  planCommand,
} from './commands';

let store: ClientStore;
let deps: CommandDeps;

beforeEach(async () => {
  ({ store } = await openTestStore());
  deps = {
    store,
    today: () => '2026-11-07',
    makeBrief: vi.fn(async () => 'made' as const),
    syncNow: vi.fn(async () => 'synced' as const),
    openDays: vi.fn(async () => {}),
    changed: vi.fn(),
    undo: createUndoStack(),
  };
});

const addTask = (title: string) => store.write((tx) => store.repos.tasks.create(tx, { title }));
const open = () => store.queries.openTasks(store.db);

async function plan(text: string, tasks?: Task[]): Promise<CommandPlan> {
  const parsed = parseCommand(text);
  if (!parsed) throw new Error('not a command');
  return planCommand(deps, parsed, tasks ?? (await open()));
}

async function run(text: string): Promise<CommandOutcome> {
  const planned = await plan(text);
  if (planned.kind !== 'run') throw new Error(`expected a run plan, got ${planned.kind}`);
  return planned.run();
}

describe('/done', () => {
  it('says which task Enter will finish, then finishes it and can undo', async () => {
    const task = await addTask('Call the plumber about the tap');
    expect(await plan('/done plumb')).toMatchObject({
      kind: 'run',
      label: 'Done: Call the plumber about the tap',
    });

    const outcome = await run('/done plumb');
    expect(outcome.message).toBe('Done: Call the plumber about the tap');
    expect(await open()).toEqual([]);
    // Written through the repository, so it syncs like any edit.
    expect((await listOutbox(store.db)).some((entry) => entry.recordId === task.id)).toBe(true);
    expect(deps.changed).toHaveBeenCalled();

    expect(await outcome.undo?.()).toBe('Reopened: Call the plumber about the tap');
    expect(await open()).toMatchObject([{ id: task.id }]);
  });

  it('lets the person pick when tasks match equally', async () => {
    await addTask('Call mum');
    await addTask('Call the bank');
    const planned = await plan('/done call');
    expect(planned.kind).toBe('choose');
    if (planned.kind !== 'choose') return;
    await planned.options[1]?.run();
    expect((await open()).map((task) => task.title)).toEqual([planned.options[0]?.label]);
  });

  it('changes nothing when no task matches, and says so', async () => {
    await addTask('Call mum');
    expect(await plan('/done dentist')).toMatchObject({
      kind: 'error',
      code: 'command_no_match',
    });
    expect(await plan('/done')).toMatchObject({ kind: 'hint' });
  });
});

describe('/undo', () => {
  it('undoes the last change, then has nothing left', async () => {
    await addTask('Water the plants');
    await run('/done water');
    expect(await open()).toEqual([]);

    expect((await run('/undo')).message).toBe('Reopened: Water the plants');
    expect(await open()).toHaveLength(1);
    expect(await plan('/undo')).toEqual({ kind: 'hint', text: 'Nothing to undo' });
  });
});

describe('/brief and /sync', () => {
  it('makes today’s brief and opens Days', async () => {
    expect((await run('/brief')).message).toBe('Today’s brief is ready');
    expect(deps.makeBrief).toHaveBeenCalledWith('2026-11-07');
    expect(deps.openDays).toHaveBeenCalled();
  });

  it('syncs and says how it went', async () => {
    expect((await run('/sync')).message).toBe('Synced');
    deps.syncNow = vi.fn(async () => 'not_configured' as const);
    expect((await run('/sync')).message).toContain('isn’t connected');
  });
});

describe('text that is no command', () => {
  it('is left for the AI to read', async () => {
    expect(await plan('/finish the plumber thing')).toEqual({
      kind: 'ask_ai',
      input: 'finish the plumber thing',
    });
  });
});
