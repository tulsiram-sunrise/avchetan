import type { ExportFile } from '@avchetan/db/sqlite';
import { NativeError } from '@avchetan/shared';
import { Directory, File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync } from 'expo-sqlite';

export type BackupList = { folder: string; files: { name: string; sizeBytes: number }[] };

const BACKUP_NAME = /^avchetan-\d{4}-\d{2}-\d{2}\.db$/;

const backupsPath = (): string => `${defaultDatabaseDirectory}/backups`;
const asUri = (path: string) => `file://${path}`;

function wrap(code: string, message: string) {
  return (cause: unknown): never => {
    throw new NativeError(code, message, { cause });
  };
}

function listBackups(): BackupList {
  const dir = new Directory(asUri(backupsPath()));
  const files = dir.exists
    ? dir
        .list()
        .filter((entry): entry is File => entry instanceof File && BACKUP_NAME.test(entry.name))
        .map((file) => ({ name: file.name, sizeBytes: file.size }))
        .sort((a, b) => b.name.localeCompare(a.name))
    : [];
  return { folder: backupsPath(), files };
}

/**
 * Copies the database (in the app's private storage, which Android doesn't back up) to
 * `name`, unless it exists and `replace` is false, then keeps the newest `keep`. `VACUUM INTO`
 * runs on a second connection, so the app's own connection and its transactions are untouched.
 */
async function createBackup(
  databaseName: string,
  name: string,
  keep: number,
  replace: boolean,
): Promise<BackupList> {
  if (!BACKUP_NAME.test(name) || keep < 1) {
    throw new NativeError('backup_invalid', 'Invalid backup name');
  }
  try {
    const dir = new Directory(asUri(backupsPath()));
    dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, name);
    if (replace || !target.exists) {
      const partial = new File(dir, `${name}.partial`);
      if (partial.exists) partial.delete();
      const source = await openDatabaseAsync(databaseName, { useNewConnection: true });
      try {
        await source.runAsync('VACUUM INTO ?', [`${backupsPath()}/${name}.partial`]);
      } finally {
        await source.closeAsync();
      }
      if (target.exists) target.delete();
      partial.move(target);
    }
    const list = listBackups();
    for (const old of list.files.slice(keep)) new File(dir, old.name).delete();
    return { ...list, files: list.files.slice(0, keep) };
  } catch (error) {
    return wrap('backup_failed', 'Could not back up the database')(error);
  }
}

/**
 * Asks where to save (Android's folder picker; Downloads works), then writes the files into a
 * new folder there. Returns that folder's name, or null when the person cancels the picker.
 */
async function writeExport(folder: string, files: readonly ExportFile[]): Promise<string | null> {
  let parent: Directory;
  try {
    parent = await Directory.pickDirectoryAsync();
  } catch {
    // The picker rejects when it is closed without choosing a folder.
    return null;
  }
  try {
    const dir = parent.createDirectory(folder);
    for (const file of files) {
      const type = file.name.endsWith('.json') ? 'application/json' : 'text/csv';
      dir.createFile(file.name, type).write(file.content);
    }
    return folder;
  } catch (error) {
    return wrap('export_failed', 'Could not save the export')(error);
  }
}

export function createDataFiles(databaseName: string) {
  return {
    listBackups: async () => listBackups(),
    createBackup: (name: string, keep: number, replace = false) =>
      createBackup(databaseName, name, keep, replace),
    writeExport,
  };
}

export type DataFiles = ReturnType<typeof createDataFiles>;
