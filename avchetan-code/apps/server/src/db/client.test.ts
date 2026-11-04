import { sql } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { openTestDatabase } from './testing';

const url = process.env.TEST_DATABASE_URL;

// PGlite runs in this process, so only Postgres can close a connection under the server.
describe.skipIf(!url)('Postgres connection pool', () => {
  it('keeps working after the database closes an idle connection', async () => {
    const database = await openTestDatabase();
    await database.db.execute(sql`select 1`);
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();

    // What a Postgres restart or an idle timeout does to the server's pooled connection.
    const result = (await database.db.execute(sql`select current_database() as name`)) as {
      rows: [{ name: string }];
    };
    const [{ name }] = result.rows;
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    await admin.end();
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(database.db.execute(sql`select 1`)).resolves.toBeDefined();
    await database.close();
  });
});
