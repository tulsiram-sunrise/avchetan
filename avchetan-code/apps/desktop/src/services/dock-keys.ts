/**
 * The capture box's keys (docs/product/capture-box-redesign.md#1-the-keyboard-always-works).
 * The text box keeps the keyboard the whole time; ↑/↓ only move a highlight through the list
 * under it, so a key typed with a row highlighted still lands in the box.
 */

/** What the list under the box shows: commands while a name is typed, else entries or sources. */
export type DockListKind = 'commands' | 'entries' | 'sources';

export type DockKeyPress = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

export type DockKeyState = {
  /** Nothing typed (spaces count as nothing). */
  draftEmpty: boolean;
  list: { kind: DockListKind; rows: number } | null;
  /** The highlighted row, or null when the keyboard is in the box. */
  highlight: number | null;
  /** An answer is showing in place of the recent entries. */
  panelOpen: boolean;
};

export type DockKeyAction =
  /** Not a dock key: the box handles it as usual. */
  | { kind: 'none' }
  | { kind: 'move'; to: number | null }
  | { kind: 'open'; row: number }
  | { kind: 'complete'; row: number }
  | { kind: 'undo' }
  | { kind: 'close_panel' }
  | { kind: 'hide' };

const NONE: DockKeyAction = { kind: 'none' };

export function dockKey(press: DockKeyPress, state: DockKeyState): DockKeyAction {
  const { key, shiftKey, ctrlKey, altKey, metaKey } = press;
  const { list, highlight } = state;
  const rows = list?.rows ?? 0;
  const plain = !ctrlKey && !altKey && !metaKey;
  // A highlight left on a row that's gone (the list got shorter) counts as none.
  const current = highlight !== null && highlight < rows ? highlight : null;

  switch (key) {
    case 'ArrowDown': {
      if (!plain || shiftKey || rows === 0) return NONE;
      if (current === null) {
        // The best command already shows lit, so the arrow goes on to the next one.
        if (list?.kind === 'commands') return { kind: 'move', to: Math.min(1, rows - 1) };
        // In a box with text the arrow moves the caret.
        return state.draftEmpty ? { kind: 'move', to: 0 } : NONE;
      }
      return { kind: 'move', to: Math.min(current + 1, rows - 1) };
    }
    case 'ArrowUp': {
      if (!plain || shiftKey || current === null) return NONE;
      return { kind: 'move', to: current === 0 ? null : current - 1 };
    }
    case 'Enter':
      return plain && current !== null ? { kind: 'open', row: current } : NONE;
    case 'Tab':
      if (!plain || shiftKey || list?.kind !== 'commands' || rows === 0) return NONE;
      return { kind: 'complete', row: current ?? 0 };
    case 'z':
    case 'Z':
      // With text in the box, Ctrl+Z is the box's own text undo.
      return ctrlKey && !shiftKey && !altKey && !metaKey && state.draftEmpty && current === null
        ? { kind: 'undo' }
        : NONE;
    case 'Escape':
      if (current !== null) return { kind: 'move', to: null };
      if (state.panelOpen) return { kind: 'close_panel' };
      return { kind: 'hide' };
    default:
      return NONE;
  }
}
