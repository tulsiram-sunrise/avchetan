import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { syncOutbox } from '../../schema/sqlite/tables';

const fields = {
  appPattern: ' Code.exe ',
  titlePattern: '  ',
  projectId: null,
  tagPaths: ['code'],
  enabled: true,
};

describe('contextRules', () => {
  it('creates, edits and soft-deletes rules, each through the outbox', async () => {
    const { store } = await openTestStore();
    const { contextRules } = store.repos;

    const first = await store.write((tx) => contextRules.create(tx, fields));
    const second = await store.write((tx) =>
      contextRules.create(tx, { ...fields, appPattern: 'Word.exe' }),
    );
    expect(first).toMatchObject({ appPattern: 'Code.exe', titlePattern: null });
    expect((await contextRules.list(store.db)).map((rule) => rule.id)).toEqual([
      first.id,
      second.id,
    ]);

    await store.write((tx) => contextRules.setEnabled(tx, first.id, false));
    expect((await contextRules.listEnabled(store.db)).map((rule) => rule.id)).toEqual([second.id]);

    await store.write((tx) => contextRules.remove(tx, second.id));
    expect(await contextRules.list(store.db)).toHaveLength(1);
    const outbox = await store.db
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.tableName, 'context_rules'));
    expect(outbox).toHaveLength(2);
  });

  it('refuses a rule without an app', async () => {
    const { store } = await openTestStore();
    await expect(
      store.write((tx) => store.repos.contextRules.create(tx, { ...fields, appPattern: ' ' })),
    ).rejects.toMatchObject({ code: 'invalid_name' });
  });
});
