/**
 * Test helpers for anything that needs a real client database: `@avchetan/db/testing`.
 * Uses Node's built-in node:sqlite, so tests need no native builds. Tests only.
 */
import { DatabaseSync } from 'node:sqlite';
import { createSequentialIds } from '@avchetan/shared/testing';
import { eq } from 'drizzle-orm';
import type { SqliteExecutor } from '../src/client/database';
import {
  type ClientStore,
  type OpenClientStoreOptions,
  openClientStore,
} from '../src/client/store';
import { settings } from '../src/schema/sqlite/tables';

/** SqliteExecutor over an in-memory (or file) node:sqlite database. */
export function createNodeSqliteExecutor(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const executor: SqliteExecutor = {
    async run(query, params) {
      raw.prepare(query).run(...(params as never[]));
    },
    async values(query, params) {
      const statement = raw.prepare(query);
      statement.setReturnArrays(true);
      return statement.all(...(params as never[])) as unknown as unknown[][];
    },
  };
  return { raw, executor };
}

export type TestStoreOptions = Partial<Omit<OpenClientStoreOptions, 'executor'>> & {
  /** Start of the fake wall clock (advances 1 ms per read). */
  start?: string;
};

/** A fully migrated, seeded client store on a fresh in-memory database. */
export async function openTestStore(options: TestStoreOptions = {}) {
  const { raw, executor } = createNodeSqliteExecutor();
  let wallMs = Date.parse(options.start ?? '2026-10-26T10:00:00.000Z');
  const store = await openClientStore({
    executor,
    newId: options.newId ?? createSequentialIds(),
    wallClock: options.wallClock ?? (() => wallMs++),
  });
  return {
    store,
    raw,
    executor,
    /** Move the fake wall clock forward. */
    advance(ms: number) {
      wallMs += ms;
    },
  };
}

/**
 * Stores a setting's value as it is, past its schema, and reads one back raw: for tests of what a
 * device does with a value an older or broken build left behind.
 */
export async function writeRawSetting(store: ClientStore, key: string, value: unknown) {
  await store.write((tx) =>
    tx
      .insert(settings)
      .values({ key, value, updatedAt: store.clock.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value } }),
  );
}

export async function readRawSetting(store: ClientStore, key: string): Promise<unknown> {
  const row = await store.db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value;
}
