import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSnapshots, snapshotFileName, writeSnapshot } from './snapshots';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'avchetan-snapshots-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeSnapshot', () => {
  it('writes once per name and keeps the newest', async () => {
    const dump = vi.fn(async () => new Blob(['tarball']));
    for (const day of ['01', '02', '03']) {
      await writeSnapshot(dump, dir, snapshotFileName(`2026-11-${day}`), 2);
    }
    await writeSnapshot(dump, dir, snapshotFileName('2026-11-03'), 2);
    await writeFile(join(dir, 'notes.txt'), 'not a snapshot');

    expect(dump).toHaveBeenCalledTimes(3);
    expect(await listSnapshots(dir)).toEqual(['hub-2026-11-03.tar.gz', 'hub-2026-11-02.tar.gz']);
    expect(await readFile(join(dir, 'hub-2026-11-03.tar.gz'), 'utf8')).toBe('tarball');
  });

  it('lists nothing for a folder that does not exist yet', async () => {
    expect(await listSnapshots(join(dir, 'missing'))).toEqual([]);
  });
});
