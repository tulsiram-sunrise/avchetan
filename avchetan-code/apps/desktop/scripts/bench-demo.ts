/**
 * Times the queries behind the main pages on a seeded demo database (see seed-demo.ts), for the
 * performance baseline (docs/product/finding-and-using-data.md#7-performance-baseline). Dev only.
 *
 *   pnpm --filter @avchetan/desktop demo:bench [--db <path>]
 *
 * Runs on Node's SQLite, not the app's: it measures the queries and their plans, not the IPC
 * or rendering (those are measured in the app). It runs on a copy, so pending migrations are
 * applied there only; when the copy predates the search index (ADR-0029), it reports how long
 * building the index took and how much it added. Quit the demo app first.
 */
import { copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openClientStore } from '@avchetan/db/sqlite';
import { createNodeSqliteExecutor } from '@avchetan/db/testing';
import { addDays, firstOfMonth, lastOfMonth, localDate, monthOf } from '@avchetan/shared';

const TIME_ZONE = 'Asia/Kolkata';
const RUNS = 7;

const { values: args } = parseArgs({ options: { db: { type: 'string' } } });
const dbPath = args.db ?? join(process.env.APPDATA ?? '', 'app.avchetan.demo', 'avchetan.db');

async function time(label: string, fn: () => Promise<unknown> | unknown) {
  const samples: number[] = [];
  let size = 0;
  for (let i = 0; i < RUNS; i++) {
    const began = performance.now();
    const result = await fn();
    samples.push(performance.now() - began);
    size = Array.isArray(result) ? result.length : result instanceof Map ? result.size : 1;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(RUNS / 2)] ?? 0;
  const max = samples[RUNS - 1] ?? 0;
  process.stdout.write(
    `${label.padEnd(44)} ${median.toFixed(1).padStart(8)} ms  (max ${max.toFixed(1)}, ${size} rows)\n`,
  );
}

async function main() {
  // Work on a copy: opening the store applies pending migrations (the search index among them),
  // and the demo folder should stay as the app left it.
  const copy = join(tmpdir(), 'avchetan-bench.db');
  rmSync(copy, { force: true });
  copyFileSync(dbPath, copy);
  const { raw, executor } = createNodeSqliteExecutor(copy);
  raw.exec('VACUUM');
  const before = statSync(copy).size;
  const pending = raw
    .prepare("SELECT count(*) AS n FROM avchetan_migrations WHERE tag = '0003_search_index'")
    .get() as { n: number };
  const opened = performance.now();
  const store = await openClientStore({ executor });
  const openMs = performance.now() - opened;
  const { db, queries, people, search } = store;
  const scope = { includePrivate: false };
  const today = localDate(new Date().toISOString(), TIME_ZONE);
  const yesterday = addDays(today, -1);
  const month = monthOf(yesterday);

  const counts = raw.prepare('SELECT count(*) AS n FROM raw_logs').get() as { n: number };
  process.stdout.write(
    `${dbPath}\n${counts.n} entries, ${(before / 1_048_576).toFixed(1)} MB; median of ${RUNS}\n\n`,
  );
  if (pending.n === 0) {
    raw.exec('VACUUM');
    const growth = (statSync(copy).size - before) / 1_048_576;
    process.stdout.write(
      `Search index built by the migration       ${openMs.toFixed(0).padStart(8)} ms  (+${growth.toFixed(1)} MB)\n\n`,
    );
  }
  process.stdout.write('Search (local index, ADR-0029)\n');
  for (const text of ['dentist', 'dent', 'park run', 'दौड़', 'meet', 'zebra']) {
    await time(`  searchEntries "${text}"`, () =>
      search.searchEntries(db, { ...scope, text, limit: 50 }),
    );
  }
  await time('  searchTasks "call"', () =>
    search.searchTasks(db, { ...scope, text: 'call', limit: 50 }),
  );
  await time('  searchPeople "a"', () =>
    people.searchPeople(db, { ...scope, text: 'a', today, limit: 50 }),
  );
  await time('  searchLogs "dentist" (Ask)', () =>
    queries.searchLogs(db, { ...scope, text: 'dentist', limit: 50 }),
  );
  raw.close();
  rmSync(copy, { force: true });
}

await main();
