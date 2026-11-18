import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveGeneratedToken } from './token-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'avchetan-token-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('saveGeneratedToken', () => {
  it('writes the token to a new folder and gives the full path', async () => {
    const path = await saveGeneratedToken(join(dir, 'secrets', 'sync-token.txt'), 'made-up-token');

    expect(path).toBe(join(dir, 'secrets', 'sync-token.txt'));
    expect(await readFile(path, 'utf8')).toBe('made-up-token\n');
  });

  it('replaces a file an earlier server left', async () => {
    const path = join(dir, 'sync-token.txt');
    await writeFile(path, 'old-token\n', { mode: 0o644 });

    await saveGeneratedToken(path, 'new-token');

    expect(await readFile(path, 'utf8')).toBe('new-token\n');
  });

  it.skipIf(process.platform === 'win32')('lets only its owner read it', async () => {
    const path = join(dir, 'sync-token.txt');
    await writeFile(path, 'old-token\n', { mode: 0o644 });

    await saveGeneratedToken(path, 'new-token');

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
