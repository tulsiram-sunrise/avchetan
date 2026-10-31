import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { entityTags, rawLogs, tags } from '../../schema/sqlite/tables';
import { seedCategoryId } from './categories';

const capture = (store: Awaited<ReturnType<typeof openTestStore>>['store'], content = 'entry') =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
  );

describe('rawLogs.requeue', () => {
  it('gives a failed log a fresh start on this device', async () => {
    const { store } = await openTestStore();
    const log = await capture(store);
    await store.write(async (tx) => {
      await store.repos.rawLogs.claim(tx, log, '2030-01-01T00:00:00.000Z');
      await store.repos.rawLogs.recordFailure(tx, log.id, {
        status: 'error',
        lastError: 'llm_refused: no answer',
        nextAttemptAt: null,
        countsAsAttempt: true,
      });
    });

    const requeued = await store.write((tx) => store.repos.rawLogs.requeue(tx, log.id));

    expect(requeued).toMatchObject({
      status: 'pending_llm',
      processingAttempts: 0,
      lastError: null,
      originDeviceId: store.deviceId,
    });
  });
});

describe('rawLogs.replace', () => {
  it('keeps content immutable: a new log replaces the old one', async () => {
    const { store } = await openTestStore();
    const old = await capture(store, 'first wording');

    const next = await store.write((tx) =>
      store.repos.rawLogs.replace(tx, old.id, {
        content: 'better wording',
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
      }),
    );

    expect(next.capturedAt).toBe(old.capturedAt);
    expect(next.capturedTz).toBe(old.capturedTz);

    const rows = await store.db.select().from(rawLogs);
    expect(rows.find((row) => row.id === old.id)).toMatchObject({ content: 'first wording' });
    expect(rows.find((row) => row.id === old.id)?.deletedAt).not.toBeNull();
    expect(next).toMatchObject({
      content: 'better wording',
      status: 'pending_llm',
      context: { supersedes: old.id },
    });
  });
});

describe('categories.merge', () => {
  it('points the merged category at the survivor and old names keep resolving', async () => {
    const { store } = await openTestStore();
    const gym = await store.write((tx) =>
      store.repos.categories.create(tx, { name: 'Gym', origin: 'llm', needsReview: true }),
    );

    await store.write((tx) => store.repos.categories.merge(tx, gym.id, seedCategoryId('workout')));

    expect(await store.repos.categories.listMergedAliases(store.db)).toEqual([
      { slug: 'gym', id: seedCategoryId('workout') },
    ]);
    const active = await store.repos.categories.listActive(store.db);
    expect(active.some((category) => category.id === gym.id)).toBe(false);
  });

  it('follows a chain so merges never stack', async () => {
    const { store } = await openTestStore();
    const make = (name: string) =>
      store.write((tx) => store.repos.categories.create(tx, { name, origin: 'user' }));
    const a = await make('Aaa');
    const b = await make('Bbb');
    const c = await make('Ccc');
    await store.write((tx) => store.repos.categories.merge(tx, a.id, b.id));
    await store.write((tx) => store.repos.categories.merge(tx, b.id, c.id));

    const resolved = await store.repos.categories.listResolved(store.db);
    expect(resolved.find((row) => row.id === a.id)?.resolved.id).toBe(c.id);
  });

  it('refuses a cycle', async () => {
    const { store } = await openTestStore();
    const a = await store.write((tx) =>
      store.repos.categories.create(tx, { name: 'Aaa', origin: 'user' }),
    );
    const b = await store.write((tx) =>
      store.repos.categories.create(tx, { name: 'Bbb', origin: 'user' }),
    );
    await store.write((tx) => store.repos.categories.merge(tx, a.id, b.id));

    await expect(
      store.write((tx) => store.repos.categories.merge(tx, b.id, a.id)),
    ).rejects.toMatchObject({ code: 'invalid_merge' });
  });

  it('protects the required categories', async () => {
    const { store } = await openTestStore();
    await expect(
      store.write((tx) =>
        store.repos.categories.merge(tx, seedCategoryId('other'), seedCategoryId('work')),
      ),
    ).rejects.toMatchObject({ code: 'category_required' });
  });
});

describe('tags.move', () => {
  it('renames a tag and carries its children along', async () => {
    const { store } = await openTestStore();
    const child = await store.write((tx) => store.repos.tags.ensurePath(tx, 'health/knee/left'));
    const knee = await store.repos.tags.findByPath(store.db, 'health/knee');

    await store.write((tx) => store.repos.tags.move(tx, knee?.id as string, 'body/leg'));

    const paths = (await store.repos.tags.listAll(store.db)).map((tag) => tag.path);
    expect(paths).toEqual(['body', 'body/leg', 'body/leg/left', 'health']);
    expect(await store.repos.tags.findByPath(store.db, 'body/leg/left')).toMatchObject({
      id: child.id,
    });
  });

  it('refuses a path that exists, and a move into itself', async () => {
    const { store } = await openTestStore();
    const a = await store.write((tx) => store.repos.tags.ensurePath(tx, 'aaa'));
    await store.write((tx) => store.repos.tags.ensurePath(tx, 'bbb'));

    await expect(store.write((tx) => store.repos.tags.move(tx, a.id, 'bbb'))).rejects.toMatchObject(
      { code: 'duplicate_name' },
    );
    await expect(
      store.write((tx) => store.repos.tags.move(tx, a.id, 'aaa/inner')),
    ).rejects.toMatchObject({ code: 'invalid_tag' });
  });
});

describe('tags.merge', () => {
  it('moves links to the survivor and leaves none on the merged tag', async () => {
    const { store } = await openTestStore();
    const log = await capture(store);
    const run = await store.write((tx) => store.repos.tags.ensurePath(tx, 'run'));
    const running = await store.write((tx) => store.repos.tags.ensurePath(tx, 'running'));
    await store.write((tx) =>
      store.repos.tags.link(tx, {
        tagId: run.id,
        targetType: 'raw_log',
        targetId: log.id,
        isInferred: false,
      }),
    );

    await store.write((tx) => store.repos.tags.merge(tx, run.id, running.id));

    const links = await store.repos.tags.forTarget(store.db, 'raw_log', log.id);
    expect(links).toMatchObject([{ path: 'running', isInferred: false }]);
    expect((await store.repos.tags.usage(store.db)).get(run.id)).toBeUndefined();
    expect((await store.db.select().from(entityTags)).filter((l) => !l.deletedAt)).toHaveLength(1);
    expect((await store.db.select().from(tags)).find((t) => t.id === run.id)?.mergedIntoId).toBe(
      running.id,
    );
  });
});
