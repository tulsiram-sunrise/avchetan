import { describe, expect, it } from 'vitest';
import { createTestSqlite } from '../../test/drivers';
import { openTestStore } from '../../testing';
import { runMigrations } from '../migrations/runner';
import { sqliteMigrations } from '../migrations/sqlite.generated';
import type { RemoteChange } from './apply-remote';
import { highlightParts, matchQuery } from './search';
import { getById, SYNCED_TABLES } from './synced';

const local = { includePrivate: true, limit: 50 };
const locked = { includePrivate: false, limit: 50 };
const today = '2026-10-30';

async function setup() {
  const test = await openTestStore();
  const { store } = test;
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
  const entries = async (text: string, scope = local) =>
    (await store.search.searchEntries(store.db, { ...scope, text })).map((hit) => hit.log.content);
  const taskTitles = async (text: string, scope = local) =>
    (await store.search.searchTasks(store.db, { ...scope, text })).map((hit) => hit.task.title);
  return { ...test, r, entry, entries, taskTitles };
}

describe('matchQuery', () => {
  it('makes every word a quoted prefix, so typed syntax stays literal', () => {
    expect(matchQuery('dent')).toBe('"dent"*');
    expect(matchQuery('  knee   pain ')).toBe('"knee"* "pain"*');
    expect(matchQuery('NOT "x" AND (y')).toBe('"NOT"* "x"* "AND"* "(y"*');
    expect(matchQuery('दिल्ली दौड़')).toBe('"दिल्ली"* "दौड़"*');
  });

  it('is undefined when nothing searchable was typed', () => {
    expect(matchQuery('')).toBeUndefined();
    expect(matchQuery('  - " ** ')).toBeUndefined();
  });
});

describe('highlightParts', () => {
  it('splits marked text into plain and matched parts', () => {
    expect(highlightParts('Saw the \u0002dentist\u0003 at \u0002ten\u0003')).toEqual([
      { text: 'Saw the ', match: false },
      { text: 'dentist', match: true },
      { text: ' at ', match: false },
      { text: 'ten', match: true },
    ]);
    expect(highlightParts('no match')).toEqual([{ text: 'no match', match: false }]);
  });
});

describe('searchEntries', () => {
  it('finds words from their start, needs every word, newest first', async () => {
    const { entry, entries, advance } = await setup();
    await entry('Dentist appointment moved to Friday');
    advance(1000);
    await entry('Called the dentist about the bill');
    advance(1000);
    await entry('Accident on the way, dented the bumper');

    expect(await entries('dent')).toEqual([
      'Accident on the way, dented the bumper',
      'Called the dentist about the bill',
      'Dentist appointment moved to Friday',
    ]);
    expect(await entries('DENTIST bill')).toEqual(['Called the dentist about the bill']);
    // Inside a word doesn't match: "cident" is not the start of "Accident".
    expect(await entries('cident')).toEqual([]);
    expect(await entries('zebra')).toEqual([]);
    expect(await entries('   ')).toEqual([]);
  });

  it('highlights the words it found', async () => {
    const { store, entry } = await setup();
    await entry('Ran 5 km in the park, then the park café');
    const [hit] = await store.search.searchEntries(store.db, { ...local, text: 'park cafe' });
    expect(hit?.parts).toEqual([
      { text: 'Ran 5 km in the ', match: false },
      { text: 'park', match: true },
      { text: ', then the ', match: false },
      { text: 'park', match: true },
      { text: ' ', match: false },
      { text: 'café', match: true },
    ]);
  });

  it('keeps Devanagari words whole', async () => {
    const { entry, entries } = await setup();
    await entry('दिल्ली में दौड़ लगाई');
    await entry('Ran 5 km');
    expect(await entries('दौड़')).toEqual(['दिल्ली में दौड़ लगाई']);
    expect(await entries('दिल')).toEqual(['दिल्ली में दौड़ लगाई']);
    // A letter from inside a word must not match (plain unicode61 splits at vowel signs, so
    // "ड" would be a word of its own there).
    expect(await entries('ड')).toEqual([]);
    expect(await entries('ल')).toEqual(['दिल्ली में दौड़ लगाई']); // the start of लगाई
  });

  it('leaves out private entries while locked', async () => {
    const { entry, entries } = await setup();
    await entry('Therapy session notes', 'local_only');
    await entry('Therapy invoice paid');
    expect(await entries('therapy')).toHaveLength(2);
    expect(await entries('therapy', locked)).toEqual(['Therapy invoice paid']);
  });

  it('follows edits, deletes and undeletes', async () => {
    const { store, r, entry, entries } = await setup();
    const log = await entry('Bought apples');
    const replaced = await store.write((tx) =>
      r.rawLogs.replace(tx, log.id, {
        content: 'Bought oranges',
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
        explicitTagPaths: [],
      }),
    );
    expect(await entries('apples')).toEqual([]);
    expect(await entries('oranges')).toEqual(['Bought oranges']);

    await store.write((tx) => r.rawLogs.softDelete(tx, replaced.id));
    expect(await entries('oranges')).toEqual([]);
  });

  it('pages with an offset', async () => {
    const { store, entry, advance } = await setup();
    for (let i = 1; i <= 5; i++) {
      await entry(`Walk number ${i}`);
      advance(1000);
    }
    const page = (offset: number) =>
      store.search
        .searchEntries(store.db, { ...local, text: 'walk', limit: 2, offset })
        .then((hits) => hits.map((hit) => hit.log.content));
    expect(await page(0)).toEqual(['Walk number 5', 'Walk number 4']);
    expect(await page(2)).toEqual(['Walk number 3', 'Walk number 2']);
    expect(await page(4)).toEqual(['Walk number 1']);
  });

  it('indexes rows applied by sync, and their deletes', async () => {
    const a = await setup();
    const b = await setup();
    const log = await a.entry('Picked up the parcel');
    const deliver = async () => {
      const outbox = await a.store.sync.listOutbox();
      const changes: RemoteChange[] = [];
      for (const item of outbox) {
        const row = await getById(a.store.db, SYNCED_TABLES[item.tableName], item.recordId);
        if (row) changes.push({ table: item.tableName, row } as RemoteChange);
      }
      await b.store.sync.applyRemote(changes);
      await a.store.sync.ackOutbox(outbox);
    };
    await deliver();
    expect(await b.entries('parcel')).toEqual(['Picked up the parcel']);

    await a.store.write((tx) => a.r.rawLogs.softDelete(tx, log.id));
    await deliver();
    expect(await b.entries('parcel')).toEqual([]);
  });
});

describe('searchLogs (Ask)', () => {
  it('uses the index: every word, from its start', async () => {
    const { store, entry } = await setup();
    await entry('Knee felt stiff after the run');
    await entry('Bought knee support');
    const logs = await store.queries.searchLogs(store.db, { ...local, text: 'knee stiff' });
    expect(logs.map((log) => log.content)).toEqual(['Knee felt stiff after the run']);
  });
});

describe('searchTasks', () => {
  it('finds titles, open ones first, and hides tasks from private entries while locked', async () => {
    const { store, r, entry, taskTitles, advance } = await setup();
    const secret = await entry('Book the clinic visit', 'local_only');
    await store.write((tx) =>
      r.tasks.create(tx, { title: 'Book clinic visit', rawLogId: secret.id }),
    );
    advance(1000);
    const done = await store.write((tx) => r.tasks.create(tx, { title: 'Book flights' }));
    await store.write((tx) => r.tasks.complete(tx, done.id));
    advance(1000);
    await store.write((tx) => r.tasks.create(tx, { title: 'Return library book' }));

    expect(await taskTitles('book')).toEqual([
      'Return library book',
      'Book clinic visit',
      'Book flights',
    ]);
    expect(await taskTitles('book', locked)).toEqual(['Return library book', 'Book flights']);

    const renamed = await store.write((tx) =>
      r.tasks.editByUser(tx, done.id, { title: 'Book trains' }),
    );
    expect(await taskTitles('flights')).toEqual([]);
    expect(await taskTitles('trains')).toEqual([renamed.title]);
  });
});

describe('searchPeople', () => {
  it('finds a person by name or alias, only with a mention in scope', async () => {
    const { store, r, entry } = await setup();
    const log = await entry('Lunch with Rahul');
    const secret = await entry('Talked to Meera', 'local_only');
    const rahul = await store.write((tx) =>
      r.entities.ensure(tx, { kind: 'person', name: 'Rahul' }),
    );
    const meera = await store.write((tx) =>
      r.entities.ensure(tx, { kind: 'person', name: 'Meera' }),
    );
    await store.write((tx) =>
      r.entities.mention(tx, {
        entityId: rahul.id,
        targetType: 'raw_log',
        targetId: log.id,
        role: 'with',
      }),
    );
    await store.write((tx) =>
      r.entities.mention(tx, {
        entityId: meera.id,
        targetType: 'raw_log',
        targetId: secret.id,
        role: 'with',
      }),
    );
    await store.write((tx) => r.entities.rename(tx, rahul.id, 'Rahul Verma'));

    const names = async (text: string, includePrivate = true) =>
      (await store.people.searchPeople(store.db, { text, today, includePrivate, limit: 50 })).map(
        (person) => person.entity.name,
      );
    expect(await names('verma')).toEqual(['Rahul Verma']);
    expect(await names('rah')).toEqual(['Rahul Verma']);
    expect(await names('meera')).toEqual(['Meera']);
    expect(await names('meera', false)).toEqual([]);
  });
});

describe('migration 0003_search_index', () => {
  it('indexes the rows that existed before it', async () => {
    const { raw, driver } = createTestSqlite();
    const now = () => '2026-10-26T10:00:00.000Z';
    await runMigrations(driver, sqliteMigrations.slice(0, 3), { now });
    const sync = `'2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', 'dev'`;
    raw.exec(`
      INSERT INTO raw_logs (id, created_at, updated_at, updated_by_device, content, captured_at,
        captured_tz, source, status, origin_device_id)
      VALUES ('l1', ${sync}, 'Old dentist visit', '2026-10-26T10:00:00.000Z', 'UTC', 'desktop_text', 'processed', 'dev');
      INSERT INTO raw_logs (id, created_at, updated_at, updated_by_device, deleted_at, content,
        captured_at, captured_tz, source, status, origin_device_id)
      VALUES ('l2', ${sync}, '2026-10-26T10:00:00.000Z', 'Deleted dentist note', '2026-10-26T10:00:00.000Z', 'UTC', 'desktop_text', 'processed', 'dev');
      INSERT INTO tasks (id, created_at, updated_at, updated_by_device, title, origin)
      VALUES ('t1', ${sync}, 'Pay the dentist', 'user');
      INSERT INTO entities (id, created_at, updated_at, updated_by_device, kind, name, normalized_name, aliases)
      VALUES ('e1', ${sync}, 'person', 'Dr Rao', 'dr rao', '["Dentist Rao"]');
    `);
    await runMigrations(driver, sqliteMigrations, { now });
    const hits = raw
      .prepare(
        `SELECT r.kind, r.ref_id FROM search_index JOIN search_rows r ON r.id = search_index.rowid
         WHERE search_index MATCH '"dentist"*' ORDER BY r.kind`,
      )
      .all()
      .map((row) => `${row.kind}:${row.ref_id}`);
    expect(hits).toEqual(['entity:e1', 'entry:l1', 'task:t1']);
  });
});
