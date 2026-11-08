import { derivedId } from '@avchetan/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { entityMentions, rawLogs, tasks } from '../schema/sqlite/tables';
import { duplicatePairKey, duplicateSuggestions } from './people';
import { seedCategoryId } from './repos/categories';
import type { Entity } from './repos/entities';

const today = '2026-10-30';
const local = { includePrivate: true, today };
const cloud = { includePrivate: false, today };

async function setup() {
  const { store } = await openTestStore();
  const r = store.repos;
  const entry = (content: string, privacy: 'normal' | 'local_only' = 'normal') =>
    store.write((tx) =>
      r.rawLogs.capture(tx, {
        content,
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
        explicitTagPaths: [],
        privacy,
      }),
    );
  const person = (name: string) =>
    store.write((tx) => r.entities.ensure(tx, { kind: 'person', name }));
  const task = (rawLogId: string, title: string, dueDate: string | null = null) =>
    store.write((tx) => r.tasks.create(tx, { title, rawLogId, dueDate }));
  const mention = (
    entityId: string,
    targetType: 'raw_log' | 'activity' | 'task',
    targetId: string,
    role: 'with' | 'about' | 'owed_to' | 'owed_by',
  ) => store.write((tx) => r.entities.mention(tx, { entityId, targetType, targetId, role }));
  return { store, r, entry, person, task, mention };
}

describe('entities.ensure', () => {
  it('finds a renamed or merged person by an old name', async () => {
    const { store, r, person } = await setup();
    const rahul = await person('Rahul');
    const sharma = await person('Rahul Sharma');
    await store.write((tx) => r.entities.rename(tx, rahul.id, 'Rahul Verma'));
    expect((await person('rahul')).id).toBe(rahul.id);
    expect((await person('Rahul Verma')).id).toBe(rahul.id);

    await store.write((tx) => r.entities.merge(tx, sharma.id, rahul.id));
    // The merged-away derived ID is deleted; the name now finds the survivor.
    expect((await person('Rahul Sharma')).id).toBe(rahul.id);
    expect(sharma.id).toBe(derivedId('entity', 'person', 'rahul sharma'));
  });
});

describe('entities.rename and merge', () => {
  it('rename keeps the old name as an alias and refuses a taken name', async () => {
    const { store, r, person } = await setup();
    const a = await person('Amn');
    await person('Priya');
    const renamed = await store.write((tx) => r.entities.rename(tx, a.id, 'Aman'));
    expect(renamed).toMatchObject({
      id: a.id,
      name: 'Aman',
      normalizedName: 'aman',
      aliases: ['Amn'],
    });
    await expect(store.write((tx) => r.entities.rename(tx, a.id, 'priya'))).rejects.toMatchObject({
      code: 'duplicate_name',
    });
  });

  it('merge moves mentions and names, and deletes the other', async () => {
    const { store, r, entry, person, task, mention } = await setup();
    const log = await entry('Lunch with Rahul S, promised the schema');
    const t = await task(log.id, 'Send the schema');
    const into = await person('Rahul');
    const from = await person('Rahul S');
    await mention(from.id, 'raw_log', log.id, 'with');
    await mention(from.id, 'task', t.id, 'owed_to');
    await mention(into.id, 'raw_log', log.id, 'with');

    const merged = await store.write((tx) => r.entities.merge(tx, from.id, into.id));
    expect(merged.aliases).toEqual(['Rahul S']);
    const live = await store.db
      .select()
      .from(entityMentions)
      .where(isNull(entityMentions.deletedAt));
    expect(live.map((m) => [m.entityId, m.targetType, m.role]).sort()).toEqual(
      [
        [into.id, 'raw_log', 'with'],
        [into.id, 'task', 'owed_to'],
      ].sort(),
    );
    const people = await store.people.listPeople(store.db, local);
    expect(people.map((p) => p.entity.name)).toEqual(['Rahul']);
    await expect(store.write((tx) => r.entities.merge(tx, into.id, into.id))).rejects.toMatchObject(
      { code: 'invalid_merge' },
    );
  });
});

describe('promises', () => {
  it('lists both directions with status filters, and links by hand', async () => {
    const { store, r, entry, person, task, mention } = await setup();
    const log = await entry('Promised Rahul the schema; Aman will send photos by Friday');
    const owe = await task(log.id, 'Send Rahul the schema', '2026-10-29');
    const wait = await task(log.id, 'Get the photos from Aman', '2026-11-01');
    const plain = await task(log.id, 'Buy milk');
    const rahul = await person('Rahul');
    const aman = await person('Aman');
    await mention(rahul.id, 'task', owe.id, 'owed_to');
    await mention(aman.id, 'task', wait.id, 'owed_by');

    const all = await store.people.promises(store.db, {
      ...local,
      direction: 'both',
      status: 'open',
    });
    expect(all.map((p) => [p.task.title, p.role, p.entity.name])).toEqual([
      ['Send Rahul the schema', 'owed_to', 'Rahul'],
      ['Get the photos from Aman', 'owed_by', 'Aman'],
    ]);
    const overdue = await store.people.promises(store.db, {
      ...local,
      direction: 'i_owe',
      status: 'overdue',
    });
    expect(overdue.map((p) => p.task.id)).toEqual([owe.id]);
    expect(
      (
        await store.people.promises(store.db, { ...local, direction: 'owed_to_me', status: 'open' })
      ).map((p) => p.task.id),
    ).toEqual([wait.id]);

    await store.write((tx) => r.tasks.complete(tx, owe.id));
    const done = await store.people.promises(store.db, {
      ...local,
      direction: 'both',
      status: 'done',
    });
    expect(done.map((p) => p.task.id)).toEqual([owe.id]);

    await store.write((tx) =>
      r.entities.linkPromise(tx, { taskId: plain.id, entityId: aman.id, role: 'owed_to' }),
    );
    const links = await store.people.promiseLinks(store.db, [plain.id, wait.id]);
    expect(links.get(plain.id)).toEqual([
      { role: 'owed_to', entity: { id: aman.id, name: 'Aman' } },
    ]);
    expect(await store.people.waitingTaskIds(store.db)).toEqual(new Set([wait.id]));

    await store.write((tx) => r.entities.unlinkPromise(tx, { taskId: wait.id }));
    expect(await store.people.waitingTaskIds(store.db)).toEqual(new Set());
    const unlinked = await store.db.select().from(tasks).where(eq(tasks.id, wait.id)).get();
    expect(unlinked).toMatchObject({ isUserEdited: true, deletedAt: null });
  });

  it('leaves out private entries for a cloud read', async () => {
    const { store, entry, person, task, mention } = await setup();
    const secret = await entry('Promised Neha the money', 'local_only');
    const t = await task(secret.id, 'Pay Neha back');
    const neha = await person('Neha');
    await mention(neha.id, 'task', t.id, 'owed_to');
    await mention(neha.id, 'raw_log', secret.id, 'about');

    const opts = { direction: 'both', status: 'open' } as const;
    expect(await store.people.promises(store.db, { ...local, ...opts })).toHaveLength(1);
    expect(await store.people.promises(store.db, { ...cloud, ...opts })).toEqual([]);
    expect(await store.people.findEntities(store.db, { ...cloud, limit: 10 })).toEqual([]);
    const [onDevice] = await store.people.listPeople(store.db, local);
    expect(onDevice).toMatchObject({ youOwe: 1, onlyPrivate: true });
  });
});

describe('listPeople and personDetail', () => {
  it('summarizes last seen, entries and open promises, promises first', async () => {
    const { store, r, entry, person, task, mention } = await setup();
    const lunch = await entry('Lunch with Priya');
    const activity = await store.write((tx) =>
      r.activities.create(tx, {
        categoryId: seedCategoryId('diet'),
        title: 'Lunch',
        loggedDate: '2026-10-28',
        rawLogId: lunch.id,
      }),
    );
    const call = await entry('Call Aman back about the trip');
    const t = await task(call.id, 'Call Aman back', '2026-10-27');
    const priya = await person('Priya');
    const aman = await person('Aman');
    await mention(priya.id, 'activity', activity.id, 'with');
    await mention(aman.id, 'task', t.id, 'owed_to');

    const list = await store.people.listPeople(store.db, local);
    expect(list.map((p) => [p.entity.name, p.lastSeen, p.youOwe, p.overdue])).toEqual([
      ['Aman', null, 1, 1],
      ['Priya', '2026-10-28', 0, 0],
    ]);

    const detail = await store.people.personDetail(store.db, { ...local, id: aman.id });
    expect(detail?.rawLogIds).toEqual([call.id]);
    expect(detail?.open.map((p) => p.task.id)).toEqual([t.id]);

    const topic = await store.people.entitiesInLogs(store.db, [lunch.id]);
    expect(topic).toEqual([priya.id]);
    const found = await store.people.findEntities(store.db, { ...cloud, name: 'pri', limit: 5 });
    expect(found.map((p) => p.entity.id)).toEqual([priya.id]);
  });

  it('drops mentions whose entry was deleted', async () => {
    const { store, r, entry, person, mention } = await setup();
    const log = await entry('Met Kabir');
    const kabir = await person('Kabir');
    await mention(kabir.id, 'raw_log', log.id, 'with');
    await store.write((tx) => r.rawLogs.softDelete(tx, log.id));
    expect(await store.people.listPeople(store.db, local)).toEqual([]);
    const live = await store.db
      .select()
      .from(entityMentions)
      .where(and(isNull(entityMentions.deletedAt)));
    expect(live).toEqual([]);
  });
});

describe('duplicateSuggestions', () => {
  const entity = (id: string, normalizedName: string): Entity =>
    ({
      id,
      kind: 'person',
      name: normalizedName,
      normalizedName,
      aliases: [],
    }) as unknown as Entity;

  it('pairs a first name with a full name and one-letter typos', () => {
    const people = [
      entity('1', 'rahul'),
      entity('2', 'rahul sharma'),
      entity('3', 'priya'),
      entity('4', 'pria'),
      entity('5', 'raj'),
      entity('6', 'ram'),
    ];
    const pairs = duplicateSuggestions(people).map((p) => [p.a.id, p.b.id]);
    expect(pairs).toEqual([
      ['1', '2'],
      ['4', '3'],
    ]);
    expect(duplicateSuggestions(people, new Set([duplicatePairKey('2', '1')]))).toHaveLength(1);
  });
});

describe('the daily brief', () => {
  it('lists waiting-on tasks apart from your rolled-over ones', async () => {
    const { store, entry, person, task, mention } = await setup();
    const log = await entry('Farhan will send the photos by Monday; renew insurance by Monday');
    const photos = await task(log.id, 'Get the photos from Farhan', '2026-10-26');
    const insurance = await task(log.id, 'Renew the insurance', '2026-10-26');
    const farhan = await person('Farhan');
    await mention(farhan.id, 'task', photos.id, 'owed_by');

    const day = { day: '2026-10-27', includePrivate: true };
    const rolled = await store.queries.rolledOverTasks(store.db, day);
    expect(rolled.map((t) => t.id)).toEqual([insurance.id]);
    const waiting = await store.people.waitingDue(store.db, day);
    expect(waiting.map((w) => [w.task.id, w.entity.name])).toEqual([[photos.id, 'Farhan']]);
    expect(await store.people.waitingDue(store.db, { ...day, day: '2026-10-25' })).toEqual([]);
  });
});

describe('entriesToRecheckForPromises', () => {
  it('finds older entries with a task that name a person, oldest first', async () => {
    const { store, entry, person, task, mention } = await setup();
    const organized = async (content: string, version: number) => {
      const log = await entry(content);
      // Test-only: as if the processor had organized it with that prompt version.
      await store.db
        .update(rawLogs)
        .set({ status: 'processed', extractionVersion: version })
        .where(eq(rawLogs.id, log.id));
      return log;
    };
    const old = await organized('send Rahul the deck', 3);
    const noTask = await organized('lunch with Rahul', 3);
    const current = await organized('send Rahul the notes', 4);
    const noPerson = await organized('buy milk', 3);
    const rahul = await person('Rahul');
    for (const log of [old, current, noPerson]) await task(log.id, 'A task');
    await mention(rahul.id, 'raw_log', old.id, 'about');
    await mention(rahul.id, 'raw_log', noTask.id, 'with');
    await mention(rahul.id, 'raw_log', current.id, 'about');

    expect(await store.people.entriesToRecheckForPromises(store.db, { version: 4 })).toEqual([
      old.id,
    ]);
  });
});

describe('unnamed people', () => {
  it('are left off the People list', async () => {
    const { store, entry, person, mention } = await setup();
    const log = await entry('talked to a friend and to Asha');
    for (const name of ['friend', 'Asha', 'राहुल']) {
      const p = await person(name);
      await mention(p.id, 'raw_log', log.id, 'with');
    }
    const names = (await store.people.listPeople(store.db, local)).map((p) => p.entity.name);
    expect(names.sort()).toEqual(['Asha', 'राहुल']);
  });
});
