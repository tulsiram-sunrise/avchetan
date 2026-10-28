import { NativeError } from '@avchetan/shared';
import { z } from 'zod';

/** The Tauri `invoke` shape; injected so native wrappers can be tested without a webview. */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** What `CommandError` (src-tauri/src/error.rs) serializes to. */
const commandErrorSchema = z.object({ code: z.string(), message: z.string() });

/**
 * Calls a Rust command and validates its result. Rejections become `NativeError` with the
 * Rust error code, so callers switch on `code` the same way everywhere.
 */
export async function callNative<T>(
  invoke: Invoke,
  command: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke(command, args);
  } catch (error) {
    const parsed = commandErrorSchema.safeParse(error);
    if (parsed.success) {
      throw new NativeError(parsed.data.code, parsed.data.message, {
        cause: error,
        details: { command },
      });
    }
    throw new NativeError('ipc_failed', 'Native command failed', {
      cause: error,
      details: { command },
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new NativeError('ipc_invalid_result', 'Native command returned an unexpected value', {
      details: { command },
    });
  }
  return result.data;
}
