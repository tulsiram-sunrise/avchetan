import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startDailyBackups } from '@avchetan/db/sqlite';
import { type Cancel, localDate, type Scheduler, systemTimeZone } from '@avchetan/shared';

/**
 * The hub's daily snapshot of its PGlite data folder (deployment-modes.md, Home Hub backups).
 * Every device also holds a full copy, so this guards against losing the hub's own state:
 * the token, the device list and the search index. Postgres servers use `pg_dump` instead.
 */

const SNAPSHOT_NAME = /^hub-\d{4}-\d{2}-\d{2}\.tar\.gz$/;

export function snapshotFileName(date: string): string {
  return `hub-${date}.tar.gz`;
}

/** Snapshot names in `dir`, newest first. */
export async function listSnapshots(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter((name) => SNAPSHOT_NAME.test(name)).sort((a, b) => b.localeCompare(a));
}

/** Writes today's snapshot unless it exists, then keeps the newest `keep`. */
export async function writeSnapshot(
  dump: () => Promise<Blob>,
  dir: string,
  name: string,
  keep: number,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const exists = await stat(target).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const partial = `${target}.partial`;
    const blob = await dump();
    await writeFile(partial, Buffer.from(await blob.arrayBuffer()));
    await rename(partial, target);
  }
  for (const old of (await listSnapshots(dir)).slice(keep)) await rm(join(dir, old));
}

export function startHubSnapshots(options: {
  dump: () => Promise<Blob>;
  dir: string;
  scheduler: Scheduler;
  now: () => string;
}): Cancel {
  return startDailyBackups({
    scheduler: options.scheduler,
    today: () => localDate(options.now(), systemTimeZone()),
    fileName: snapshotFileName,
    backup: (name, keep) => writeSnapshot(options.dump, options.dir, name, keep),
  });
}
