/**
 * Times a whole history going up to a hub and down to a new device, for the sync baseline
 * (docs/roadmap.md#v060--security, Day 1; measured again after Day 8's batched sync). Dev only.
 *
 *   pnpm --filter @avchetan/server bench:sync [--db <path>] [--batch 500]
 *
 * `--db` is a seeded demo database (`pnpm --filter @avchetan/desktop demo:seed`); by default the
 * 50,000-entry one kept at `%APPDATA%\app.avchetan.demo-50k`. It works on a copy, so the demo
 * stays as it was. The copy meets a new hub, so it queues every row again and pushes them all,
 * as a device moving to a new server does; then an empty device pulls everything.
 *
 * Everything runs in this one Node process: the sync engine on Node's SQLite and the hub on a
 * PGlite folder, as the built-in Home Hub keeps it. So it measures the engine, the protocol and
 * the hub's database work, not the PC's calls into Rust or the network; the in-app number from
 * v0.4.0 (21 min) stays in the roadmap beside it.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PG_SYNCED_TABLES } from '@avchetan/db/pg';
import { openClientStore } from '@avchetan/db/sqlite';
import { createNodeSqliteExecutor } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { createSyncEngine, loadSyncStatus, saveConnection } from '@avchetan/sync';
import { createApp } from '../src/app';
import { loadServerIdentity } from '../src/auth';
import { openPglite } from '../src/db/client';

const TOKEN = 'bench-token-that-is-long-enough-to-pass-the-check';
const URL = 'https://hub.bench';

const { values: args } = parseArgs({
  options: { db: { type: 'string' }, batch: { type: 'string', default: '500' } },
});
const source = args.db ?? join(process.env.APPDATA ?? '', 'app.avchetan.demo-50k', 'avchetan.db');
const batch = Number(args.batch);

const out = (line: string) => process.stdout.write(`${line}\n`);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function openDevice(path: string, fetch: HttpFetch, name: string) {
  const { raw, executor } = createNodeSqliteExecutor(path);
  const store = await openClientStore({ executor });
  const secrets = new MemorySecretStore();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  const engine = createSyncEngine({
    store,
    fetch,
    secrets,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    device: { name, platform: 'windows', extractionMode: 'self' },
    pushBatchSize: batch,
  });
  const outbox = () =>
    (raw.prepare('SELECT count(*) AS n FROM sync_outbox').get() as { n: number }).n;
  return { store, engine, outbox, raw };
}

async function main() {
  if (!existsSync(source)) {
    throw new Error(`No demo database at ${source}; seed one with demo:seed, or pass --db`);
  }
  const work = mkdtempSync(join(tmpdir(), 'avchetan-bench-sync-'));
  try {
    const copy = join(work, 'device.db');
    copyFileSync(source, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
    }

    const database = await openPglite(join(work, 'hub'));
    const clock = createMonotonicClock();
    await database.migrate(() => clock.now());
    const identity = await loadServerIdentity(database.db, TOKEN);
    // The hub's per-device limit (60 requests a minute) is part of the app, not of what is
    // measured here: each request sees a new minute, so a fast run is never held back by it.
    let minutes = 0;
    const app = createApp({
      db: database.db,
      identity,
      clock,
      version: 'bench',
      profile: 'hub',
      nowMs: () => Date.now() + 61_000 * minutes++,
    });
    const fetch: HttpFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));

    const sender = await openDevice(copy, fetch, 'Bench PC');
    out(`batch size ${batch}; device database ${source}`);
    let began = performance.now();
    await sender.engine.syncNow();
    const upMs = performance.now() - began;
    const status = await loadSyncStatus(sender.store);
    let rows = 0;
    for (const table of Object.values(PG_SYNCED_TABLES)) rows += await database.db.$count(table);
    out(
      `up:   ${seconds(upMs)}, state ${status.state}, ${sender.outbox()} left in the outbox` +
        ` (${rows} synced rows on the hub)`,
    );

    const receiver = await openDevice(join(work, 'new.db'), fetch, 'Bench new PC');
    began = performance.now();
    await receiver.engine.syncNow();
    const downMs = performance.now() - began;
    const pulled = (
      receiver.raw.prepare('SELECT count(*) AS n FROM raw_logs').get() as { n: number }
    ).n;
    out(`down: ${seconds(downMs)}, ${pulled} entries on the new device`);

    sender.raw.close();
    receiver.raw.close();
    await database.close();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
