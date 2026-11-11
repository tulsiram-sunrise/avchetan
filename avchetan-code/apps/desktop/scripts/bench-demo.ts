/**
 * Times the queries behind the main pages on a seeded demo database (see seed-demo.ts), for the
 * performance baseline (docs/product/finding-and-using-data.md#7-performance-baseline). Dev only.
 *
 *   pnpm --filter @avchetan/desktop demo:bench [--db <path>]
 *
 * Runs on Node's SQLite, not the app's: it measures the queries and their plans, not the IPC
 * or rendering (those are measured in the app). It also tries the planned search index
 * (ADR-0029) on a copy, for its size and speed. Quit the demo app first.
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
  const { raw, executor } = createNodeSqliteExecutor(dbPath);
  const store = await openClientStore({ executor });
  const { db, queries, people } = store;
  const scope = { includePrivate: false };
  const today = localDate(new Date().toISOString(), TIME_ZONE);
  const yesterday = addDays(today, -1);
  const month = monthOf(yesterday);

  const counts = raw.prepare('SELECT count(*) AS n FROM raw_logs').get() as { n: number };
  process.stdout.write(
    `${dbPath}\n${counts.n} entries, ${(statSync(dbPath).size / 1_048_576).toFixed(1)} MB; median of ${RUNS}\n\n`,
  );

  process.stdout.write('Days\n');
  await time('  dayEntries (yesterday)', () =>
    queries.dayEntries(db, { day: yesterday, timeZone: TIME_ZONE }),
  );
  await time('  activitiesOn (yesterday)', () => queries.activitiesOn(db, yesterday));
  await time('  dayTasks (yesterday)', () =>
    queries.dayTasks(db, { day: yesterday, today, timeZone: TIME_ZONE }),
  );
  await time('  monthDots (this month)', () =>
    queries.monthDots(db, {
      from: firstOfMonth(month),
      to: lastOfMonth(month),
      timeZone: TIME_ZONE,
    }),
  );
  process.stdout.write('Tasks\n');
  await time('  openTasks', () => queries.openTasks(db));
  await time('  completedTasks', () => queries.completedTasks(db));
  process.stdout.write('People\n');
  await time('  listPeople', () => people.listPeople(db, { ...scope, today }));
  const first = (await people.listPeople(db, { ...scope, today }))[0];
  if (first) {
    await time('  personDetail (busiest)', () =>
      people.personDetail(db, { ...scope, id: first.entity.id, today }),
    );
  }
  process.stdout.write('Capture box and tray\n');
  await time('  recentRawLogs (5)', () => queries.recentRawLogs(db, { limit: 5 }));
  await time('  pendingCount', () => queries.pendingCount(db));
  process.stdout.write('Search today (instr, used by Ask)\n');
  await time('  searchLogs "dentist"', () =>
    queries.searchLogs(db, { ...scope, text: 'dentist', limit: 50 }),
  );
  await time('  searchLogs "दौड़"', () =>
    queries.searchLogs(db, { ...scope, text: 'दौड़', limit: 50 }),
  );
  raw.close();

  // The planned index (ADR-0029), tried on a copy.
  const copy = join(tmpdir(), 'avchetan-bench-fts.db');
  rmSync(copy, { force: true });
  copyFileSync(dbPath, copy);
  const fts = createNodeSqliteExecutor(copy).raw;
  fts.exec('VACUUM');
  const before = statSync(copy).size;
  const build = performance.now();
  fts.exec(`
    CREATE VIRTUAL TABLE search_index USING fts5(
      content, content='raw_logs', content_rowid='rowid',
      tokenize = "unicode61 categories 'L* N* Co M*'"
    );
    INSERT INTO search_index(rowid, content) SELECT rowid, content FROM raw_logs;
  `);
  const buildMs = performance.now() - build;
  fts.exec('VACUUM');
  const growth = (statSync(copy).size - before) / 1_048_576;
  process.stdout.write(
    `Search index (FTS5, on a copy)\n  build from ${counts.n} entries${''.padEnd(13)} ${buildMs.toFixed(0).padStart(8)} ms  (+${growth.toFixed(1)} MB)\n`,
  );
  const match = fts.prepare(
    `SELECT r.id FROM search_index s JOIN raw_logs r ON r.rowid = s.rowid
     WHERE search_index MATCH ? AND r.deleted_at IS NULL ORDER BY rank LIMIT 50`,
  );
  for (const term of ['dentist', 'park', 'दौड़', 'meet*', 'zebra']) {
    await time(`  match "${term}"`, () => match.all(term));
  }
  fts.close();
  rmSync(copy, { force: true });
}

await main();
