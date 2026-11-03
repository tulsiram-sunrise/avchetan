import { readdir, readFile } from 'node:fs/promises';
import { ValidationError } from '@avchetan/shared';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

/**
 * Unpacks a hub snapshot into an empty PGlite data folder. The hub must be stopped, and the
 * current folder moved aside first: this never overwrites one.
 */
export async function restoreSnapshot(snapshotFile: string, dataDir: string): Promise<void> {
  const existing = await readdir(dataDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (existing.length > 0) {
    throw new ValidationError(
      'restore_target_not_empty',
      'The data folder is not empty. Stop the hub and move the folder aside first',
      { details: { dataDir } },
    );
  }
  const tarball = new Blob([await readFile(snapshotFile)]);
  const client = await PGlite.create(dataDir, { loadDataDir: tarball, extensions: { vector } });
  await client.close();
}
