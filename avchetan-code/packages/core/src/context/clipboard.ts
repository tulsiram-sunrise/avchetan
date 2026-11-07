import { z } from 'zod';
import { type ContextSettings, isDenied, type WindowContext } from './window-context';

/**
 * Clipboard snap (docs/product/clipboard-snap.md): the clipboard text the second shortcut
 * attaches to an entry. The desktop shell reads and cuts it; what is kept is decided here.
 */

/** Stored at most (UTF-8 bytes), as the shell cuts it. */
export const MAX_CLIPBOARD_BYTES = 4096;
/** What the extraction model sees of it. */
export const PROMPT_CLIPBOARD_BYTES = 1024;

export const clipboardNoTextSchema = z.enum(['empty', 'not_text', 'private', 'busy']);

/** What the shell reports when the clipboard shortcut fires. */
export const clipboardReadSchema = z.union([
  z.object({ text: z.string(), cut: z.boolean() }),
  z.object({ none: clipboardNoTextSchema }),
]);
export type ClipboardRead = z.infer<typeof clipboardReadSchema>;

/** What the dock shows: text to save with the entry, or why there is none. */
export type DockClipboard =
  | { kind: 'attached'; text: string; cut: boolean }
  | { kind: 'none'; reason: z.infer<typeof clipboardNoTextSchema> | 'denied' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Line endings made `\n`, then at most `maxBytes` of UTF-8, cut at a character boundary. */
export function cutUtf8(text: string, maxBytes: number): { text: string; cut: boolean } {
  const normalized = text.replace(/\r\n?/g, '\n');
  const bytes = encoder.encode(normalized);
  if (bytes.length <= maxBytes) return { text: normalized, cut: false };
  let end = maxBytes;
  // A UTF-8 continuation byte is 10xxxxxx: step back to the start of that character.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: decoder.decode(bytes.subarray(0, end)), cut: true };
}

/**
 * Applies the switch and the deny-list (checked against the window in front, before the window
 * context's own switch or pause: the clipboard shortcut is pressed on purpose). Null when off.
 */
export function filterClipboard(
  read: ClipboardRead | null,
  window: WindowContext | null,
  settings: Pick<ContextSettings, 'snapEnabled' | 'denyList'>,
): DockClipboard | null {
  if (!read || !settings.snapEnabled) return null;
  if (window && isDenied(window.app, settings.denyList)) return { kind: 'none', reason: 'denied' };
  if ('none' in read) return { kind: 'none', reason: read.none };
  if (read.text.trim() === '') return { kind: 'none', reason: 'empty' };
  // The shell already cut it; checked again so nothing larger is ever stored.
  const { text, cut } = cutUtf8(read.text, MAX_CLIPBOARD_BYTES);
  return { kind: 'attached', text, cut: cut || read.cut };
}

/** The context fields an entry keeps for `clipboard`; none unless text is attached. */
export function clipboardFields(
  clipboard: DockClipboard | null,
): { clipboard: string; clipboard_cut?: true } | Record<string, never> {
  if (clipboard?.kind !== 'attached') return {};
  return { clipboard: clipboard.text, ...(clipboard.cut ? { clipboard_cut: true } : {}) };
}

/** The clipboard text stored in an entry's context, for display; null when there is none. */
export function clipboardOf(
  context: Record<string, unknown>,
): { text: string; cut: boolean } | null {
  const parsed = z
    .object({ clipboard: z.string().min(1), clipboard_cut: z.boolean().optional() })
    .safeParse(context);
  return parsed.success
    ? { text: parsed.data.clipboard, cut: parsed.data.clipboard_cut === true }
    : null;
}

/** What the model may see: the first 1 KB, and nothing for a private entry. */
export function clipboardForPrompt(
  context: Record<string, unknown>,
  privacy: string,
): string | null {
  if (privacy !== 'normal') return null;
  const stored = clipboardOf(context);
  return stored ? cutUtf8(stored.text, PROMPT_CLIPBOARD_BYTES).text : null;
}
