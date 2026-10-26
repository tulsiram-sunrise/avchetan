import { describe, expect, it } from 'vitest';
import { createNodeSqliteExecutor } from '../../testing';
import { createClientDatabase } from './database';

async function setup() {
  const { raw, executor } = createNodeSqliteExecutor();
  const database = createClientDatabase(executor);
  await database.migrate(() => '2026-10-26T10:00:00.000Z');
  raw.exec('CREATE TABLE probe (n integer)');
  return { raw, database };
}

describe('createClientDatabase.write', () => {
  it('commits on success', async () => {
    const { raw, database } = await setup();
    await database.write(async (tx) => {
      await tx.run('INSERT INTO probe (n) VALUES (1)');
    });
    expect(raw.prepare('SELECT count(*) AS c FROM probe').get()).toEqual({ c: 1 });
  });

  it('rolls back everything when the callback throws', async () => {
    const { raw, database } = await setup();
    await expect(
      database.write(async (tx) => {
        await tx.run('INSERT INTO probe (n) VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(raw.prepare('SELECT count(*) AS c FROM probe').get()).toEqual({ c: 0 });
  });

  it('runs concurrent write transactions one at a time, in order', async () => {
    const { raw, database } = await setup();
    const order: string[] = [];
    const slow = database.write(async (tx) => {
      order.push('a:start');
      await tx.run('INSERT INTO probe (n) VALUES (1)');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a:end');
    });
    const fast = database.write(async (tx) => {
      order.push('b:start');
      await tx.run('INSERT INTO probe (n) VALUES (2)');
      order.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(raw.prepare('SELECT count(*) AS c FROM probe').get()).toEqual({ c: 2 });
  });

  it('keeps working after a failed transaction', async () => {
    const { raw, database } = await setup();
    await database.write(async () => Promise.reject(new Error('first fails'))).catch(() => {});
    await database.write(async (tx) => {
      await tx.run('INSERT INTO probe (n) VALUES (3)');
    });
    expect(raw.prepare('SELECT n FROM probe').all()).toEqual([{ n: 3 }]);
  });
});
