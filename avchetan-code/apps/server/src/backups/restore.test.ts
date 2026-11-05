import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreSnapshot } from './restore';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'avchetan-restore-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('restoreSnapshot', () => {
  it('brings back what the snapshot held', { timeout: 60_000 }, async () => {
    const source = await PGlite.create({ extensions: { vector } });
    await source.exec("create table notes (body text); insert into notes values ('made up')");
    const snapshot = join(dir, 'hub-2026-11-03.tar.gz');
    const blob = await source.dumpDataDir('gzip');
    await writeFile(snapshot, Buffer.from(await blob.arrayBuffer()));
    await source.close();

    const dataDir = join(dir, 'pglite-data');
    await restoreSnapshot(snapshot, dataDir);

    const restored = await PGlite.create(dataDir, { extensions: { vector } });
    const { rows } = await restored.query<{ body: string }>('select body from notes');
    await restored.close();
    expect(rows).toEqual([{ body: 'made up' }]);
  });

  it('clears the data epoch, so the next start makes a new one', { timeout: 60_000 }, async () => {
    const source = await PGlite.create({ extensions: { vector } });
    await source.exec(`create table server_meta (server_id uuid, data_epoch uuid);
      insert into server_meta values (gen_random_uuid(), gen_random_uuid())`);
    const snapshot = join(dir, 'hub-2026-11-04.tar.gz');
    await writeFile(snapshot, Buffer.from(await (await source.dumpDataDir('gzip')).arrayBuffer()));
    await source.close();

    const dataDir = join(dir, 'pglite-data');
    await restoreSnapshot(snapshot, dataDir);

    const restored = await PGlite.create(dataDir, { extensions: { vector } });
    const { rows } = await restored.query('select data_epoch from server_meta');
    await restored.close();
    expect(rows).toEqual([{ data_epoch: null }]);
  });

  it('refuses a data folder that is not empty', async () => {
    const dataDir = join(dir, 'pglite-data');
    await mkdir(dataDir);
    await writeFile(join(dataDir, 'PG_VERSION'), '17');
    await expect(restoreSnapshot(join(dir, 'missing.tar.gz'), dataDir)).rejects.toMatchObject({
      code: 'restore_target_not_empty',
    });
  });
});
