import type { ExportFile } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const backupListSchema = z.object({
  folder: z.string(),
  /** Newest first. */
  files: z.array(z.object({ name: z.string(), sizeBytes: z.number().int().nonnegative() })),
});
export type BackupList = z.infer<typeof backupListSchema>;

export type DataFolder = 'backups' | 'exports';

/** Backup and export files (src-tauri/src/commands/data.rs). */
export function createDataFiles(invoke: Invoke) {
  return {
    listBackups: () => callNative(invoke, 'backup_list', {}, backupListSchema),
    createBackup: (name: string, keep: number, replace = false) =>
      callNative(invoke, 'backup_create', { name, keep, replace }, backupListSchema),
    /** Writes into `Documents/Avchetan exports/<folder>/` and returns that folder's path. */
    writeExport: (folder: string, files: readonly ExportFile[]) =>
      callNative(invoke, 'export_write', { folder, files }, z.object({ folder: z.string() })),
    openFolder: (folder: DataFolder) =>
      callNative(invoke, 'data_folder_open', { folder }, z.null()),
  };
}

export type DataFiles = ReturnType<typeof createDataFiles>;
