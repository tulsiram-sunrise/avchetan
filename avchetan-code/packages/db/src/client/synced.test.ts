import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { entityTags, syncOutbox } from '../schema/sqlite/tables';
import { getById, insertSyncedRow } from './synced';

describe('insertSyncedRow', () => {
  it('returns exactly the stored row and enqueues the outbox in the same transaction', async () => {
    const { store } = await openTestStore();
    const deps = { deviceId: store.deviceId, clock: store.clock, newId: () => 'unused' };

    const returned = await store.write((tx) =>
      insertSyncedRow(tx, deps, entityTags, {
        id: '0199a000-0000-7000-8000-000000000001',
        tagId: '0199a000-0000-7000-8000-000000000002',
        targetType: 'raw_log',
        targetId: '0199a000-0000-7000-8000-000000000003',
        isInferred: false,
        confidence: null,
      }),
    );

    expect(await getById(store.db, entityTags, returned.id)).toEqual(returned);
    const outbox = await store.db.select().from(syncOutbox);
    expect(outbox.filter((o) => o.recordId === returned.id)).toHaveLength(1);
  });

  it('writes nothing when the transaction fails afterwards', async () => {
    const { store } = await openTestStore();
    const deps = { deviceId: store.deviceId, clock: store.clock, newId: () => 'unused' };

    await expect(
      store.write(async (tx) => {
        await insertSyncedRow(tx, deps, entityTags, {
          id: '0199a000-0000-7000-8000-000000000004',
          tagId: 't',
          targetType: 'task',
          targetId: 'x',
          isInferred: true,
          confidence: 0.5,
        });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    expect(await store.db.select().from(entityTags)).toHaveLength(0);
  });
});
