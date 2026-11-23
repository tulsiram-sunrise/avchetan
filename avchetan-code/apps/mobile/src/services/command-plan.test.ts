import {
  createUndoStack,
  parseCommand,
  rememberCapture,
  type SharedCommandDeps,
} from '@avchetan/core';
import { type ClientStore, listOutbox } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phoneSuggestions, planPhoneCommand } from './command-plan';

let store: ClientStore;
let deps: SharedCommandDeps;

beforeEach(async () => {
  ({ store } = await openTestStore());
  deps = {
    write: { store, today: () => '2026-11-07', textSource: 'mobile_text' },
    words: { device: 'phone', syncPlace: 'More → Sync' },
    today: () => '2026-11-07',
    makeBrief: vi.fn(async () => 'made' as const),
    syncNow: vi.fn(async () => 'synced' as const),
    openDays: vi.fn(async () => {}),
    openSearch: vi.fn(async () => {}),
    changed: vi.fn(),
    undo: createUndoStack(),
  };
});

async function plan(text: string) {
  const parsed = parseCommand(text);
  if (!parsed) throw new Error('not a command');
  return planPhoneCommand(deps, parsed, await store.queries.openTasks(store.db));
}

async function run(text: string) {
  const planned = await plan(text);
  if (planned.kind !== 'run') throw new Error(`expected a run plan, got ${planned.kind}`);
  return planned.run();
}

const addTask = (title: string) => store.write((tx) => store.repos.tasks.create(tx, { title }));

describe('the phone’s commands', () => {
  it('suggests only /done and /undo', () => {
    expect(phoneSuggestions('')).toEqual(['done', 'undo']);
    expect(phoneSuggestions('dn')).toEqual(['done']);
    expect(phoneSuggestions('ulk')).toEqual([]);
  });

  it('says what it can do for a bare /', async () => {
    expect(await plan('/')).toEqual({
      kind: 'hint',
      text: 'On the phone: /done and words from a task, or /undo',
    });
  });

  it('marks the matching task done, then /undo reopens it, both synced', async () => {
    const task = await addTask('Water the plants');

    expect(await plan('/done plants')).toMatchObject({ label: 'Done: Water the plants' });
    expect((await run('/done plants')).message).toBe('Done: Water the plants');
    expect(await store.queries.openTasks(store.db)).toEqual([]);

    expect((await run('/undo')).message).toBe('Reopened: Water the plants');
    expect((await store.queries.openTasks(store.db)).map((open) => open.id)).toEqual([task.id]);
    expect((await listOutbox(store.db)).some((entry) => entry.recordId === task.id)).toBe(true);
  });

  it('lets you pick when several tasks match', async () => {
    await addTask('Call the bank');
    await addTask('Call the dentist');

    expect(await plan('/done call')).toMatchObject({ kind: 'choose' });
  });

  it('takes back the entry just saved', async () => {
    const rawLog = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'Bought oranges',
        source: 'mobile_text',
        capturedTz: 'UTC',
        explicitTagPaths: [],
      }),
    );
    rememberCapture(deps, rawLog);

    expect((await run('/undo')).message).toBe('Deleted: “Bought oranges”');
    expect(await plan('/undo')).toEqual({
      kind: 'hint',
      text: 'Nothing to undo since Avchetan started',
    });
  });

  it.each([
    [
      '/sync',
      '/sync is on the PC only for now. On the phone: /done and words from a task, or /undo',
    ],
    ['/fly away', 'Not a command. On the phone: /done and words from a task, or /undo'],
  ])('keeps to its two commands: %s', async (text, message) => {
    expect(await plan(text)).toMatchObject({ kind: 'error', message });
  });

  it('asks you to tap a command that fits a part of a word', async () => {
    expect(await plan('/und')).toEqual({ kind: 'hint', text: 'Tap a command' });
  });
});
