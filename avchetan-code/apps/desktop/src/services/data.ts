import {
  BACKUPS_KEPT,
  backupFileName,
  type ClientStore,
  exportFiles,
  startDailyBackups,
} from '@avchetan/db/sqlite';
import { type Cancel, localDate } from '@avchetan/shared';
import type { BackupList } from '../native/data-files';
import type { Platform } from '../platform';
import type { TimeZoneCache } from './time-zone';

type DataDeps = { store: ClientStore; platform: Platform; timeZone: TimeZoneCache };

const today = ({ store, timeZone }: DataDeps) => localDate(store.clock.now(), timeZone.current());

/** Daily database copies; only the dock runs this, as it never closes. */
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

/** Writes JSON + CSV into a new dated folder and returns its path. */
export async function exportEverything({ store, platform }: DataDeps): Promise<string> {
  const data = await store.exportData();
  // 2026-11-03T14:03:11.402Z → avchetan-export-2026-11-03-140311 (UTC, like exportedAt).
  const stamp = data.exportedAt.slice(0, 19).replace('T', '-').replaceAll(':', '');
  const { folder } = await platform.files.writeExport(
    `avchetan-export-${stamp}`,
    exportFiles(data),
  );
  return folder;
}
