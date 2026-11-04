import { configureLogging, toAppError } from '@avchetan/shared';
import { restoreSnapshot } from './backups/restore';
import { loadEnv } from './env';

/**
 * `pnpm --filter @avchetan/server restore:hub <snapshot file>`: puts a hub snapshot back into
 * PGLITE_DATA_DIR (docs/user-guide/backup-and-restore.md). Messages go straight to the
 * terminal; they hold paths only.
 */
async function main(): Promise<void> {
  const env = loadEnv(process.env);
  configureLogging({ level: env.LOG_LEVEL });
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: restore:hub <path to hub-YYYY-MM-DD.tar.gz>\n');
    process.exit(2);
  }
  await restoreSnapshot(file, env.PGLITE_DATA_DIR);
  process.stdout.write(`Restored into ${env.PGLITE_DATA_DIR}. Start the hub again.\n`);
}

main().catch((error: unknown) => {
  const { code, message } = toAppError(error);
  process.stderr.write(`Restore failed (${code}): ${message}\n`);
  process.exit(1);
});
