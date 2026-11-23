import type { Shared } from '../../modules/share-intent';

/** Enough for a long message or a page's text; a whole book is cut here. */
export const MAX_SHARED_CHARS = 20_000;

/**
 * The capture draft after a share (docs/product/tasks-routines-reminders.md §12). A browser
 * shares the page's title as the subject and its link as the text, so the title goes first;
 * a subject the text already holds isn't repeated. What was already typed is kept, above it.
 */
export function draftWithShared(draft: string, shared: Shared): string {
  const text = shared.text.trim();
  const subject = shared.subject?.trim() ?? '';
  let added = subject && !text.includes(subject) ? `${subject}\n${text}` : text;
  if (added.length > MAX_SHARED_CHARS) added = `${added.slice(0, MAX_SHARED_CHARS).trimEnd()}…`;
  const before = draft.trimEnd();
  return before ? `${before}\n\n${added}` : added;
}
