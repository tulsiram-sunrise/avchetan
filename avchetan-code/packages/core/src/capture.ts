import type { CaptureInput } from '@avchetan/db/sqlite';
import { parseCaptureText } from './normalize/capture-text';

/**
 * Turns what the user typed into the input for `store.repos.rawLogs.capture`: explicit
 * `#tags` normalized and `!private` honoured. The text itself is kept verbatim.
 *
 *   await store.write((tx) =>
 *     store.repos.rawLogs.capture(tx, buildCaptureInput(text, { source, capturedTz })));
 */
export function buildCaptureInput(
  content: string,
  options: Pick<CaptureInput, 'source' | 'capturedTz'> & { context?: Record<string, unknown> },
): CaptureInput {
  const parsed = parseCaptureText(content);
  return {
    content,
    source: options.source,
    capturedTz: options.capturedTz,
    privacy: parsed.isPrivate ? 'local_only' : 'normal',
    explicitTagPaths: parsed.tagPaths,
    ...(options.context ? { context: options.context } : {}),
  };
}
