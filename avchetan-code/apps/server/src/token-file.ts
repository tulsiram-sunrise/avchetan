import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Saves a sync token the server made itself (first start, no `SYNC_TOKEN`) to a file only this
 * user can read, instead of printing it: container logs are kept, copied and shared when asking
 * for help. Returns the full path, for the log line that says where it is.
 *
 * On Windows the permission bits do nothing; the file sits in the user's own folder there.
 */
export async function saveGeneratedToken(path: string, token: string): Promise<string> {
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  // A file left by an earlier server whose database was wiped is replaced.
  await writeFile(full, `${token}\n`, { mode: 0o600 });
  // `mode` only applies to a new file.
  await chmod(full, 0o600);
  return full;
}
