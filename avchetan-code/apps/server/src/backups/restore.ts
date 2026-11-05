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
  // The restored hub lacks what devices sent since the snapshot; a new epoch on the next start
  // tells them to send everything again (sync-protocol.md). A snapshot older than the column
  // gets it empty from its migration, which does the same.
  await client.exec(`do $$ begin
    if exists (select 1 from information_schema.columns
               where table_name = 'server_meta' and column_name = 'data_epoch') then
      update server_meta set data_epoch = null;
    end if;
  end $$`);
  await client.close();
}
