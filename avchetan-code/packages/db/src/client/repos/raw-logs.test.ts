import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { entityTags, rawLogs, syncOutbox, tags } from '../../schema/sqlite/tables';
import { seedCategoryId } from './categories';

const capture = (content: string, explicitTagPaths: string[] = []) => ({
  content,
  source: 'desktop_text' as const,
  capturedTz: 'Asia/Kolkata',
  explicitTagPaths,
});

describe('rawLogs.capture', () => {
  it('saves a pending raw log owned by this device', async () => {
    const { store } = await openTestStore();
    const log = await store.write((tx) => store.repos.rawLogs.capture(tx, capture('  Ran 5k  ')));
    expect(log).toMatchObject({
      content: 'Ran 5k',
      status: 'pending_llm',
      originDeviceId: store.deviceId,
      updatedByDevice: store.deviceId,
      capturedTz: 'Asia/Kolkata',
      privacy: 'normal',
      context: {},
      processingAttempts: 0,
      deletedAt: null,
    });
    expect(log.createdAt).toBe(log.capturedAt);
  });

  it('creates explicit tags (with parents) and links them, all in the outbox', async () => {
    const { store } = await openTestStore();
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(
        tx,
        capture('Ran #running #health/knee', ['running', 'Health/Knee']),
      ),
    );

    const tagRows = await store.db.select().from(tags);
    expect(tagRows.map((t) => t.path).sort()).toEqual(['health', 'health/knee', 'running']);
    const knee = tagRows.find((t) => t.path === 'health/knee');
    const health = tagRows.find((t) => t.path === 'health');
    expect(knee?.parentId).toBe(health?.id);

    const links = await store.repos.tags.forTarget(store.db, 'raw_log', log.id);
    expect(links.map((l) => [l.path, l.isInferred]).sort()).toEqual([
      ['health/knee', false],
      ['running', false],
    ]);

    const outbox = await store.db.select().from(syncOutbox);
    const byTable = (name: string) => outbox.filter((o) => o.tableName === name).length;
    expect(byTable('raw_logs')).toBe(1);
    expect(byTable('tags')).toBe(3);
    expect(byTable('entity_tags')).toBe(2);
  });

  it('links a tag once when two spellings resolve to it', async () => {
    const { store } = await openTestStore();
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, capture('Ran #Running #running', ['Running', 'running'])),
    );

    const links = await store.repos.tags.forTarget(store.db, 'raw_log', log.id);
    expect(links.map((l) => l.path)).toEqual(['running']);
  });

  it('rejects empty content and unknown time zones', async () => {
    const { store } = await openTestStore();
    await expect(
      store.write((tx) => store.repos.rawLogs.capture(tx, capture('   '))),
    ).rejects.toMatchObject({
      code: 'empty_capture',
    });
    await expect(
      store.write((tx) =>
        store.repos.rawLogs.capture(tx, { ...capture('x'), capturedTz: 'Mars/Base' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_time_zone' });
  });

  it('writes nothing if any part of the capture fails', async () => {
    const { store } = await openTestStore();
    const outboxBefore = (await store.db.select().from(syncOutbox)).length;
    await expect(
      store.write((tx) => store.repos.rawLogs.capture(tx, capture('Ran', ['running', '!!!']))),
    ).rejects.toMatchObject({ code: 'invalid_tag' });
    expect(await store.db.select().from(rawLogs)).toEqual([]);
    expect(await store.db.select().from(tags)).toEqual([]);
    expect((await store.db.select().from(syncOutbox)).length).toBe(outboxBefore);
  });
});

describe('rawLogs.softDelete', () => {
  it('cascades to extracted rows and every link pointing at them', async () => {
    const { store } = await openTestStore();
    const { log, activity, task } = await store.write(async (tx) => {
      const log = await store.repos.rawLogs.capture(tx, capture('Ran, buy milk', ['running']));
      const activity = await store.repos.activities.create(tx, {
        categoryId: seedCategoryId('workout'),
        title: 'Run',
        loggedDate: '2026-10-26',
        rawLogId: log.id,
      });
      const task = await store.repos.tasks.create(tx, { title: 'Buy milk', rawLogId: log.id });
      const tag = await store.repos.tags.ensurePath(tx, 'running');
      await store.repos.tags.link(tx, {
        tagId: tag.id,
        targetType: 'activity',
        targetId: activity.id,
        isInferred: true,
      });
      const person = await store.repos.entities.ensure(tx, { kind: 'person', name: 'Aman' });
      await store.repos.entities.mention(tx, {
        entityId: person.id,
        targetType: 'task',
        targetId: task.id,
        role: 'about',
      });
      return { log, activity, task };
    });

    await store.write((tx) => store.repos.rawLogs.softDelete(tx, log.id));

    expect(await store.queries.rawLogDetail(store.db, log.id)).toBeUndefined();
    const liveLinks = await store.db.select().from(entityTags).where(isNull(entityTags.deletedAt));
    expect(liveLinks).toEqual([]);
    const deletedActivity = await store.db.query.activities.findFirst({
      where: (a, { eq }) => eq(a.id, activity.id),
    });
    expect(deletedActivity?.deletedAt).not.toBeNull();
    const deletedTask = await store.db.query.tasks.findFirst({
      where: (t, { eq }) => eq(t.id, task.id),
    });
    expect(deletedTask?.deletedAt).not.toBeNull();
    const mentions = await store.db.query.entityMentions.findMany({
      where: (m, { and, isNull }) => and(isNull(m.deletedAt)),
    });
    expect(mentions).toEqual([]);

    // The tag itself survives; only links are removed.
    expect(
      await store.db
        .select()
        .from(tags)
        .where(and(eq(tags.path, 'running'), isNull(tags.deletedAt))),
    ).toHaveLength(1);
  });
});
