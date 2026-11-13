/**
 * Whether a key event comes from a place the user types in. Single-letter keys (T, M, ?) and the
 * arrows must not act there.
 */
export function isTyping(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}
