import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCaptureInput } from '../capture';
import { loadVocabulary } from './input';

let store: ClientStore;

beforeEach(async () => {
  ({ store } = await openTestStore());
});

const capture = (text: string) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(
      tx,
      buildCaptureInput(text, { source: 'desktop_text', capturedTz: 'UTC' }),
    ),
  );

async function mention(logId: string, name: string) {
  await store.write(async (tx) => {
    const entity = await store.repos.entities.ensure(tx, { kind: 'person', name });
    await store.repos.entities.mention(tx, {
      entityId: entity.id,
      targetType: 'raw_log',
      targetId: logId,
      role: 'about',
    });
  });
}

describe('vocabulary sent to a cloud model', () => {
  it('leaves out tags used only in private entries', async () => {
    await capture('a secret #therapy !private');
    await capture('a normal day #running');

    const vocabulary = await loadVocabulary(store);

    expect(vocabulary.tagPaths).toEqual(['running']);
  });

  it('keeps a tag that is also used in a normal entry', async () => {
    await capture('a secret #health !private');
    await capture('a normal day #health');

    expect((await loadVocabulary(store)).tagPaths).toEqual(['health']);
  });

  it('leaves out names known only from private entries', async () => {
    const secret = await capture('a secret !private');
    const normal = await capture('a normal day');
    await mention(secret.id, 'Hidden Person');
    await mention(normal.id, 'Open Person');

    expect((await loadVocabulary(store)).entityNames).toEqual(['Open Person']);
  });

  it('is the default when no scope is given', async () => {
    await capture('a secret #therapy !private');

    expect((await loadVocabulary(store)).tagPaths).toEqual([]);
  });

  it('may include everything for a local model', async () => {
    await capture('a secret #therapy !private');

    const vocabulary = await loadVocabulary(store, { includePrivate: true });

    expect(vocabulary.tagPaths).toEqual(['therapy']);
  });
});
