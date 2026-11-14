import { serverJobs } from '@avchetan/db/pg';
import { count } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { enqueueEmbedJobs } from './jobs';

let database: ServerDatabase;

beforeEach(async () => {
  database = await openTestDatabase();
  await database.migrate(() => new Date().toISOString());
});

afterEach(() => database.close());

describe('enqueueEmbedJobs', () => {
  it('queues more jobs than one statement can bind (a large history turning search on)', async () => {
    // 15,000 jobs bind 75,000 values: past Postgres's limit of 65,535 for one statement.
    const ids = Array.from({ length: 15_000 }, () => crypto.randomUUID());
    await enqueueEmbedJobs(database.db, ids);
    const [row] = await database.db.select({ n: count() }).from(serverJobs);
    expect(row?.n).toBe(15_000);

    // Queuing again moves the same jobs forward instead of adding more.
    await enqueueEmbedJobs(database.db, ids.slice(0, 10));
    const [again] = await database.db.select({ n: count() }).from(serverJobs);
    expect(again?.n).toBe(15_000);
  }, 120_000);
});
