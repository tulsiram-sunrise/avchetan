import { AppError } from './errors';
import type { LogFields } from './logger';

/** One stack frame: `at name (path:line:col)` or `at path:line:col` (V8, WebView2 and Hermes). */
const FRAME = /^\s*at\s+(?:(.+?)\s+\()?(?:address at\s+)?(.+?):(\d+)(?::(\d+))?\)?\s*$/;
/** Our own code inside the workspace, wherever it was checked out. */
const OWN_CODE = /(?:^|\/)((?:apps|packages)\/[^/]+\/(?:src|scripts)\/.+)$/;

type Frame = { name: string | undefined; path: string; line: string; column: string | undefined };

function parseFrames(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const text of stack.split('\n')) {
    const match = FRAME.exec(text);
    if (!match?.[2] || !match[3]) continue;
    frames.push({ name: match[1], path: match[2], line: match[3], column: match[4] });
  }
  return frames;
}

/** A path with no folder above the workspace (no user name), a URL without its origin. */
function relativePath(path: string): string {
  const plain = path
    .replace(/^file:\/\/\/?/, '')
    .replace(/\?.*$/, '')
    .replaceAll('\\', '/');
  const own = OWN_CODE.exec(plain)?.[1];
  if (own) return own;
  const library = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(plain)?.[1];
  if (library) return library;
  return plain.slice(plain.lastIndexOf('/') + 1);
}

const isLibrary = (frame: Frame) =>
  frame.path.includes('node_modules') || frame.path.startsWith('node:');

/**
 * Where an error was thrown: the first frame in our own code (a library's otherwise), as
 * `name (packages/core/src/file.ts:12:5)`. In a bundled build the path is the bundle's file name.
 */
export function thrownAt(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return undefined;
  const frames = parseFrames(error.stack);
  const frame = frames.find((candidate) => !isLibrary(candidate)) ?? frames[0];
  if (!frame) return undefined;
  const place = `${relativePath(frame.path)}:${frame.line}${frame.column ? `:${frame.column}` : ''}`;
  const name = frame.name?.replace(/^async\s+/, '');
  return name ? `${name} (${place})` : place;
}

/**
 * What to log about a failure: its code, its kind and where it was thrown. Never the message,
 * which can carry entry text (a failed parse quotes its input) or a path with the user's name.
 * `details` are logged too: AppError keeps them free of user content.
 */
export function errorFields(error: unknown): LogFields {
  // toAppError wraps an unexpected error as `internal`: where *that* was thrown is what matters.
  const original =
    error instanceof AppError && error.code === 'internal' && error.cause instanceof Error
      ? error.cause
      : error;
  const fields: LogFields = {
    code: error instanceof AppError ? error.code : 'internal',
    error: original instanceof Error ? original.name : typeof original,
  };
  // Node's system errors say what failed in a word: EADDRINUSE, ECONNREFUSED, ENOENT.
  const system = (original as { code?: unknown } | null)?.code;
  if (!(original instanceof AppError) && typeof system === 'string' && /^E[A-Z]+$/.test(system)) {
    fields.systemCode = system;
  }
  const at = thrownAt(original);
  if (at) fields.at = at;
  if (error instanceof AppError && error.details) fields.details = error.details;
  return fields;
}
