import { NativeError } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callNative } from './ipc';

describe('callNative', () => {
  it('returns the validated result', async () => {
    const invoke = async () => ({ path: 'C:/data/avchetan.db' });
    await expect(
      callNative(invoke, 'db_open', {}, z.object({ path: z.string() })),
    ).resolves.toEqual({ path: 'C:/data/avchetan.db' });
  });

  it('maps a Rust CommandError to NativeError with its code', async () => {
    const invoke = async () => {
      throw { code: 'db_query_failed', message: 'no such table: nope' };
    };
    const error = await callNative(invoke, 'db_values', {}, z.null()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NativeError);
    expect(error).toMatchObject({ code: 'db_query_failed', details: { command: 'db_values' } });
  });

  it('maps anything else thrown to ipc_failed', async () => {
    const invoke = async () => {
      throw 'window closed';
    };
    await expect(callNative(invoke, 'dock_hide', {}, z.null())).rejects.toMatchObject({
      code: 'ipc_failed',
    });
  });

  it('rejects a result that does not match the schema', async () => {
    const invoke = async () => ({ unexpected: true });
    await expect(
      callNative(invoke, 'db_open', {}, z.object({ path: z.string() })),
    ).rejects.toMatchObject({ code: 'ipc_invalid_result' });
  });
});
