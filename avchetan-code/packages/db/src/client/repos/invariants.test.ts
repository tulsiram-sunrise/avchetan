import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { syncOutbox } from '../../schema/sqlite/tables';
import * as people from '../people';
import * as queries from '../queries';
import * as search from '../search';
import type { ClientStore } from '../store';
import { SYNCED_TABLES, type SyncedTableName } from '../synced';

/**
 * The repository rules (CLAUDE.md rules 2 and 3), checked for every write method at once:
 * each row a write changes gets a newer `updated_at`, this device's ID and exactly one outbox
 * pointer; a write that rolls back leaves no trace; and reads hide deleted rows.
 * A new repository method belongs in WRITES (and a new read in READS).
 */

const TODAY = '2026-10-26';
const UTC = 'UTC';
const scope = { includePrivate: true };

type Store = ClientStore;
type Tx = Parameters<Parameters<Store['write']>[0]>[0];
type Snapshot = Map<string, { updatedAt: string; updatedByDevice: string; row: unknown }>;

async function snapshot(store: Store): Promise<Snapshot> {
  const rows: Snapshot = new Map();
  for (const [name, table] of Object.entries(SYNCED_TABLES)) {
    const found = (await store.db.select().from(table)) as {
      id: string;
      updatedAt: string;
      updatedByDevice: string;
    }[];
    for (const row of found) rows.set(`${name}:${row.id}`, { ...row, row });
  }
  return rows;
}

const outboxKeys = async (store: Store) =>
  (await store.db.select().from(syncOutbox)).map((e) => `${e.tableName}:${e.recordId}`);

/** Rows the background makes for every store (seed categories), plus one of each kind. */
async function fixtures(store: Store) {
  return store.write(async (tx) => {
    const [category] = await store.db.query.categories.findMany();
    if (!category) throw new Error('no seed category');
    const log = await store.repos.rawLogs.capture(tx, {
      content: 'Walked with Asha #health',
      source: 'desktop_text',
      capturedTz: UTC,
    });
    const task = await store.repos.tasks.create(tx, { title: 'Pay rent' });
    const activity = await store.repos.activities.create(tx, {
      categoryId: category.id,
      title: 'Walk',
      loggedDate: TODAY,
    });
    const project = await store.repos.projects.create(tx, { name: 'Garden' });
    const tag = await store.repos.tags.ensurePath(tx, 'health/walking');
    const otherTag = await store.repos.tags.ensurePath(tx, 'outdoors');
    const link = await store.repos.tags.link(tx, {
      tagId: tag.id,
      targetType: 'task',
      targetId: task.id,
      isInferred: false,
    });
    const person = await store.repos.entities.ensure(tx, { kind: 'person', name: 'Asha' });
    const otherPerson = await store.repos.entities.ensure(tx, { kind: 'person', name: 'Ravi' });
    for (const each of [person, otherPerson]) {
      await store.repos.entities.mention(tx, {
        entityId: each.id,
        targetType: 'raw_log',
        targetId: log.id,
        role: 'with',
      });
    }
    const userCategory = await store.repos.categories.create(tx, {
      name: 'Hobbies',
      origin: 'user',
    });
    const rule = await store.repos.contextRules.create(tx, {
      appPattern: 'code',
      titlePattern: null,
      projectId: null,
      tagPaths: [],
      enabled: true,
    });
    const routine = await store.repos.routines.create(tx, {
      title: 'Water plants',
      kind: 'confirm',
      repeatRule: { freq: 'daily', start: '2026-10-01' },
    });
    return {
      category,
      userCategory,
      log,
      task,
      activity,
      project,
      tag,
      otherTag,
      link,
      person,
      otherPerson,
      rule,
      routine,
    };
  });
}

type Fixtures = Awaited<ReturnType<typeof fixtures>>;
type Write = (store: Store, tx: Tx, f: Fixtures) => Promise<unknown>;

const WRITES: Record<string, Write> = {
  'rawLogs.capture': (s, tx) =>
    s.repos.rawLogs.capture(tx, { content: 'New entry', source: 'mobile_text', capturedTz: UTC }),
  'rawLogs.setPrivacy': (s, tx, f) => s.repos.rawLogs.setPrivacy(tx, f.log.id, 'local_only'),
  'rawLogs.requeue': (s, tx, f) => s.repos.rawLogs.requeue(tx, f.log.id),
  'rawLogs.replace': (s, tx, f) =>
    s.repos.rawLogs.replace(tx, f.log.id, {
      content: 'Walked with Asha and Ravi',
      source: 'desktop_text',
      capturedTz: UTC,
    }),
  'rawLogs.softDelete': (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),

  'tasks.create': (s, tx) => s.repos.tasks.create(tx, { title: 'Call the bank' }),
  'tasks.editByUser': (s, tx, f) => s.repos.tasks.editByUser(tx, f.task.id, { title: 'Pay it' }),
  'tasks.complete': (s, tx, f) =>
    s.repos.tasks.complete(tx, f.task.id, '2026-11-20', 'Paid online'),
  'tasks.partlyDone': (s, tx, f) => s.repos.tasks.partlyDone(tx, f.task.id, 40),
  'tasks.cancel': (s, tx, f) => s.repos.tasks.cancel(tx, f.task.id, '2026-11-20'),
  'tasks.setReminder': (s, tx, f) =>
    s.repos.tasks.setReminder(tx, f.task.id, '2026-11-21T10:30:00.000Z'),
  'tasks.deleteByUser': (s, tx, f) => s.repos.tasks.deleteByUser(tx, f.task.id),
  'tasks.softDelete': (s, tx, f) => s.repos.tasks.softDelete(tx, f.task.id),

  'activities.create': (s, tx, f) =>
    s.repos.activities.create(tx, { categoryId: f.category.id, title: 'Run', loggedDate: TODAY }),
  'activities.editByUser': (s, tx, f) =>
    s.repos.activities.editByUser(tx, f.activity.id, { title: 'Long walk' }),
  'activities.deleteByUser': (s, tx, f) => s.repos.activities.deleteByUser(tx, f.activity.id),
  'activities.softDelete': (s, tx, f) => s.repos.activities.softDelete(tx, f.activity.id),

  'categories.create': (s, tx) => s.repos.categories.create(tx, { name: 'Music', origin: 'user' }),
  'categories.rename': (s, tx, f) => s.repos.categories.rename(tx, f.userCategory.id, 'Pastimes'),
  'categories.markReviewed': (s, tx, f) => s.repos.categories.markReviewed(tx, f.userCategory.id),
  'categories.archive': (s, tx, f) => s.repos.categories.archive(tx, f.userCategory.id),
  'categories.merge': (s, tx, f) => s.repos.categories.merge(tx, f.userCategory.id, f.category.id),
  'categories.softDelete': (s, tx, f) => s.repos.categories.softDelete(tx, f.userCategory.id),

  'projects.create': (s, tx) => s.repos.projects.create(tx, { name: 'Kitchen' }),
  'projects.rename': (s, tx, f) => s.repos.projects.rename(tx, f.project.id, 'Backyard'),
  'projects.softDelete': (s, tx, f) => s.repos.projects.softDelete(tx, f.project.id),

  'tags.ensurePath': (s, tx) => s.repos.tags.ensurePath(tx, 'reading/novels'),
  'tags.link': (s, tx, f) =>
    s.repos.tags.link(tx, {
      tagId: f.otherTag.id,
      targetType: 'activity',
      targetId: f.activity.id,
      isInferred: true,
    }),
  'tags.unlink': (s, tx, f) => s.repos.tags.unlink(tx, [f.link.id]),
  'tags.recolor': (s, tx, f) => s.repos.tags.recolor(tx, f.tag.id, '#336699'),
  'tags.setMakesPrivate': (s, tx, f) => s.repos.tags.setMakesPrivate(tx, f.tag.id, true),
  'tags.move': (s, tx, f) => s.repos.tags.move(tx, f.otherTag.id, 'health/outdoors'),
  'tags.merge': (s, tx, f) => s.repos.tags.merge(tx, f.otherTag.id, f.tag.id),

  'entities.ensure': (s, tx) => s.repos.entities.ensure(tx, { kind: 'person', name: 'Meera' }),
  'entities.mention': (s, tx, f) =>
    s.repos.entities.mention(tx, {
      entityId: f.person.id,
      targetType: 'raw_log',
      targetId: f.log.id,
      role: 'with',
    }),
  'entities.rename': (s, tx, f) => s.repos.entities.rename(tx, f.person.id, 'Asha K'),
  'entities.merge': (s, tx, f) => s.repos.entities.merge(tx, f.otherPerson.id, f.person.id),
  'entities.linkPromise': (s, tx, f) =>
    s.repos.entities.linkPromise(tx, { taskId: f.task.id, entityId: f.person.id, role: 'owed_to' }),

  'contextRules.create': (s, tx) =>
    s.repos.contextRules.create(tx, {
      appPattern: 'browser',
      titlePattern: 'docs',
      projectId: null,
      tagPaths: ['reading'],
      enabled: true,
    }),
  'contextRules.update': (s, tx, f) =>
    s.repos.contextRules.update(tx, f.rule.id, {
      appPattern: 'editor',
      titlePattern: null,
      projectId: null,
      tagPaths: [],
      enabled: true,
    }),
  'contextRules.setEnabled': (s, tx, f) => s.repos.contextRules.setEnabled(tx, f.rule.id, false),
  'contextRules.remove': (s, tx, f) => s.repos.contextRules.remove(tx, f.rule.id),

  'routines.create': (s, tx) =>
    s.repos.routines.create(tx, {
      title: 'Read',
      kind: 'confirm',
      repeatRule: { freq: 'weekly', start: '2026-10-01', byWeekday: ['sunday'] },
    }),
  'routines.addStarter': (s, tx) =>
    s.repos.routines.addStarter(tx, 'drink_water', {
      title: 'Drink water',
      kind: 'confirm',
      repeatRule: { freq: 'daily', start: '2026-10-01' },
    }),
  'routines.update': (s, tx, f) =>
    s.repos.routines.update(tx, f.routine.id, {
      title: 'Water the plants',
      kind: 'confirm',
      repeatRule: { freq: 'daily', start: '2026-10-01', interval: 2 },
    }),
  'routines.pause': (s, tx, f) => s.repos.routines.pause(tx, f.routine.id),
  'routines.remove': (s, tx, f) => s.repos.routines.remove(tx, f.routine.id),
  'routines.ensureDays': (s, tx) => s.repos.routines.ensureDays(tx, TODAY),
  'routines.repeatTask': (s, tx, f) =>
    s.repos.routines.repeatTask(tx, f.task.id, { freq: 'daily', start: TODAY }, TODAY),
  'routines.stopRepeating': async (s, tx, f) => {
    await s.repos.routines.repeatTask(tx, f.task.id, { freq: 'daily', start: TODAY }, TODAY);
    await s.repos.routines.stopRepeating(tx, f.task.id);
  },
  'tasks.complete (repeating)': async (s, tx, f) => {
    await s.repos.routines.repeatTask(tx, f.task.id, { freq: 'daily', start: TODAY }, TODAY);
    await s.repos.tasks.complete(tx, f.task.id, TODAY);
  },
  'routines.tickFromEntry': async (s, tx, f) => {
    await s.repos.routines.ensureDays(tx, TODAY);
    expect(await s.repos.routines.tickFromEntry(tx, f.routine.id, TODAY, f.log.id)).toBe(true);
  },
  'routines.setDayStatus': (s, tx, f) =>
    s.repos.routines.setDayStatus(tx, f.routine.id, TODAY, 'done'),
};

/** A store with the fixtures written and synced, so the outbox starts empty. */
async function prepared() {
  const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
  const f = await fixtures(store);
  await store.sync.ackOutbox(await store.sync.listOutbox());
  return { store, f };
}

class RolledBack extends Error {}

const touchedTables = new Set<SyncedTableName>();

describe('every repository write', () => {
  it.each(Object.keys(WRITES))('%s stamps what it changes and queues it once', async (name) => {
    const { store, f } = await prepared();
    const before = await snapshot(store);

    await store.write((tx) => (WRITES[name] as Write)(store, tx, f));

    const after = await snapshot(store);
    const changed = [...after].filter(
      ([key, { row }]) => JSON.stringify(before.get(key)?.row) !== JSON.stringify(row),
    );
    expect(changed.length).toBeGreaterThan(0);
    for (const [key] of changed) touchedTables.add(key.split(':')[0] as SyncedTableName);
    const queued = await outboxKeys(store);
    for (const [key, row] of changed) {
      const old = before.get(key);
      if (old) expect(row.updatedAt > old.updatedAt, key).toBe(true);
      expect(row.updatedByDevice, key).toBe(store.deviceId);
      expect(
        queued.filter((each) => each === key),
        key,
      ).toHaveLength(1);
    }
    // Nothing is queued that didn't change.
    expect(queued.sort()).toEqual(changed.map(([key]) => key).sort());
  });

  it.each(Object.keys(WRITES))('%s leaves nothing behind when it rolls back', async (name) => {
    const { store, f } = await prepared();
    const before = await snapshot(store);

    await expect(
      store.write(async (tx) => {
        await (WRITES[name] as Write)(store, tx, f);
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);

    expect(await snapshot(store)).toEqual(before);
    expect(await outboxKeys(store)).toEqual([]);
  });

  // Runs after the cases above (a file's tests run in order) and reads what they changed.
  it('between them, writes every synced table', () => {
    expect([...touchedTables].sort()).toEqual(Object.keys(SYNCED_TABLES).sort());
  });
});

type Read = (store: Store, f: Fixtures) => Promise<unknown>;
type DeletedCase = {
  /** Makes the row show in this read, when the fixtures alone don't. */
  show?: Write;
  remove: Write;
  read: Read;
  id: (f: Fixtures) => string;
};

/**
 * Reads that return deleted rows on purpose, so they are not in READS:
 * - queries.activityById: a derived row's history (the daily brief, the weekly review)
 *   decides whether to make it again.
 */

const READS: Record<string, DeletedCase> = {
  recentRawLogs: {
    remove: (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),
    read: (s) => queries.recentRawLogs(s.db, { limit: 50 }),
    id: (f) => f.log.id,
  },
  rawLogDetail: {
    remove: (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),
    read: async (s, f) => [(await queries.rawLogDetail(s.db, f.log.id))?.rawLog].filter(Boolean),
    id: (f) => f.log.id,
  },
  dayEntries: {
    remove: (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),
    read: (s) => queries.dayEntries(s.db, { day: TODAY, timeZone: UTC }),
    id: (f) => f.log.id,
  },
  logsById: {
    remove: (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),
    read: (s, f) => queries.logsById(s.db, [f.log.id], scope),
    id: (f) => f.log.id,
  },
  searchLogs: {
    remove: (s, tx, f) => s.repos.rawLogs.softDelete(tx, f.log.id),
    read: (s) => search.searchLogs(s.db, { ...scope, text: 'walked', limit: 50 }),
    id: (f) => f.log.id,
  },
  openTasks: {
    remove: (s, tx, f) => s.repos.tasks.softDelete(tx, f.task.id),
    read: (s) => queries.openTasks(s.db),
    id: (f) => f.task.id,
  },
  completedTasks: {
    show: (s, tx, f) => s.repos.tasks.complete(tx, f.task.id, '2026-11-20'),
    remove: (s, tx, f) => s.repos.tasks.softDelete(tx, f.task.id),
    read: (s) => queries.completedTasks(s.db),
    id: (f) => f.task.id,
  },
  searchTasks: {
    remove: (s, tx, f) => s.repos.tasks.softDelete(tx, f.task.id),
    read: async (s) =>
      (await search.searchTasks(s.db, { ...scope, text: 'rent', limit: 50 })).map((h) => h.task),
    id: (f) => f.task.id,
  },
  'tasks.reminders': {
    show: (s, tx, f) => s.repos.tasks.setReminder(tx, f.task.id, '2099-01-01T08:00:00.000Z'),
    remove: (s, tx, f) => s.repos.tasks.softDelete(tx, f.task.id),
    read: async (s) =>
      (await s.repos.tasks.reminders(s.db, '2000-01-01T00:00:00.000Z', 50)).map((r) => r.task),
    id: (f) => f.task.id,
  },
  activitiesOn: {
    remove: (s, tx, f) => s.repos.activities.softDelete(tx, f.activity.id),
    read: (s) => queries.activitiesOn(s.db, TODAY),
    id: (f) => f.activity.id,
  },
  listPeople: {
    remove: (s, tx, f) => s.repos.entities.merge(tx, f.otherPerson.id, f.person.id),
    read: async (s) =>
      (await people.listPeople(s.db, { ...scope, today: TODAY })).map((p) => p.entity),
    id: (f) => f.otherPerson.id,
  },
  'tags.listAll': {
    remove: (s, tx, f) => s.repos.tags.merge(tx, f.otherTag.id, f.tag.id),
    read: (s) => s.repos.tags.listAll(s.db),
    id: (f) => f.otherTag.id,
  },
  'tags.forTarget': {
    remove: (s, tx, f) => s.repos.tags.unlink(tx, [f.link.id]),
    read: (s, f) => s.repos.tags.forTarget(s.db, 'task', f.task.id),
    id: (f) => f.tag.id,
  },
  'contextRules.list': {
    remove: (s, tx, f) => s.repos.contextRules.remove(tx, f.rule.id),
    read: (s) => s.repos.contextRules.list(s.db),
    id: (f) => f.rule.id,
  },
  'routines.list': {
    remove: (s, tx, f) => s.repos.routines.remove(tx, f.routine.id),
    read: (s) => s.repos.routines.list(s.db),
    id: (f) => f.routine.id,
  },
  'routines.daysOn': {
    remove: (s, tx, f) => s.repos.routines.remove(tx, f.routine.id),
    read: async (s) => {
      await s.write((tx) => s.repos.routines.ensureDays(tx, TODAY));
      return (await s.repos.routines.daysOn(s.db, TODAY)).map((day) => day.routine);
    },
    id: (f) => f.routine.id,
  },
};

const ids = (rows: unknown) => (rows as { id: string }[]).map((row) => row.id);

describe('every read', () => {
  it.each(Object.keys(READS))('%s shows a row, and hides it once deleted', async (name) => {
    const { store, f } = await prepared();
    const { show, remove, read, id } = READS[name] as DeletedCase;
    if (show) await store.write((tx) => show(store, tx, f));

    expect(ids(await read(store, f))).toContain(id(f));
    await store.write((tx) => remove(store, tx, f));
    expect(ids(await read(store, f))).not.toContain(id(f));
  });
});
