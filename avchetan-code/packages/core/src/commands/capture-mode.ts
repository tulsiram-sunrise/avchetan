import { parseCaptureText } from '../normalize/capture-text';
import { isCommand, parseCommand } from './parse';

/**
 * What Enter will do with the text in the capture box, for the badge at its left
 * (docs/product/capture-box-redesign.md#4-mode-badge). Changes as you type.
 */
export const CAPTURE_MODES = ['entry', 'private', 'ask', 'command', 'find'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const CAPTURE_MODE_BADGES: Record<CaptureMode, { icon: string; label: string }> = {
  entry: { icon: '✎', label: 'Entry' },
  private: { icon: '🔒', label: 'Private' },
  ask: { icon: '?', label: 'Ask' },
  command: { icon: '/', label: 'Command' },
  find: { icon: '🔍', label: 'Find' },
};

export const ASK_PREFIX = '?';

/** A tag at or under a private tag makes the entry private, as at capture. */
const isAtOrUnder = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * `privatePaths` are the tags marked private (Settings → Private tags). `/find` is a command
 * word of its own; any other `/word` is a command, and `//note` is an entry.
 */
export function captureMode(text: string, privatePaths: readonly string[] = []): CaptureMode {
  if (text.trimStart().startsWith(ASK_PREFIX)) return 'ask';
  if (isCommand(text)) return parseCommand(text)?.word === 'find' ? 'find' : 'command';
  const parsed = parseCaptureText(text);
  const privateTag = parsed.tagPaths.some((path) =>
    privatePaths.some((root) => isAtOrUnder(path, root)),
  );
  return parsed.isPrivate || privateTag ? 'private' : 'entry';
}
