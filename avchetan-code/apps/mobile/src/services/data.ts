import {
  BACKUPS_KEPT,
  backupFileName,
  type ClientStore,
  exportFiles,
  exportFolderName,
  startDailyBackups,
} from '@avchetan/db/sqlite';
import { type Cancel, localDate, systemTimeZone } from '@avchetan/shared';
import type { Platform } from '../platform';
import type { BackupList } from '../platform/data-files';

type DataDeps = { store: ClientStore; platform: Platform };

const today = ({ store }: DataDeps) => localDate(store.clock.now(), systemTimeZone());

/** Daily database copies while the app is open (Android pauses the timer off screen). */
export function startBackups(deps: DataDeps): Cancel {
  return startDailyBackups({
    scheduler: deps.platform.scheduler,
    today: () => today(deps),
    backup: (name, keep) => deps.platform.files.createBackup(name, keep),
  });
}

/** "Back up now": replaces today's copy with a fresh one. */
export function backUpNow(deps: DataDeps): Promise<BackupList> {
  return deps.platform.files.createBackup(backupFileName(today(deps)), BACKUPS_KEPT, true);
}

/** Writes JSON + CSV into a new dated folder the person picks; null when they cancel. */
export async function exportEverything({ store, platform }: DataDeps): Promise<string | null> {
  const data = await store.exportData();
  const folderName = exportFolderName(data.exportedAt, systemTimeZone());
  return platform.files.writeExport(folderName, exportFiles(data));
}
