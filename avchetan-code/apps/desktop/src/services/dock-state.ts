import { LOCK_FREE_COMMANDS, type ParsedCommand, rankCommands } from '@avchetan/core';
import type { DockListKind } from './dock-keys';

/** What the capture box knows when it decides what to show (dock/capture-input.tsx). */
export type DockStateInput = {
  locked: boolean;
  /** The text is a `?question`. */
  askMode: boolean;
  /** The text is a `/command`, parsed without learned aliases; null otherwise. */
  typed: Pick<ParsedCommand, 'command' | 'text' | 'word'> | null;
  /** Rows of each list that could show under the box. */
  suggestions: number;
  /** `/find words`: the words typed, and how many entries they found. */
  findWords: string | null;
  found: number;
  /** The open Ask panel's sources; null when no panel is open. */
  askSources: number | null;
  recent: number;
  /** The row picked with ↑/↓, if any. */
  highlight: number | null;
};

export type DockState = {
  /** The command works while locked: /lock, /unlock, /settings, or a name still being typed. */
  lockFree: boolean;
  /** Enter unlocks first: Ask and the other commands show what was written before. */
  needsUnlock: boolean;
  commandPanelShown: boolean;
  /** The list ↑/↓ move through: the one showing under the box. */
  listKind: DockListKind | null;
  listRows: number;
  /** The picked row, when it is still in the list. */
  picked: number | null;
  /** The row shown lit: the picked one, or the command list's best match. */
  lit: number | null;
};

/**
 * The capture box's list and lock state, as a pure function of what it shows. Learned aliases
 * aren't applied to `typed`, so an alias waits for an unlock like any other command.
 */
export function dockState(input: DockStateInput): DockState {
  const { locked, askMode, typed } = input;
  const commandActive = typed !== null;
  const lockFree =
    typed !== null &&
    (typed.command
      ? LOCK_FREE_COMMANDS.has(typed.command)
      : !typed.text && rankCommands(typed.word).length > 0);
  const needsUnlock = locked && (askMode || (commandActive && !lockFree));
  const commandPanelShown = !needsUnlock && !(locked && !lockFree);

  let listKind: DockListKind | null = null;
  let listRows = 0;
  if (commandActive) {
    if (commandPanelShown && input.suggestions > 0) {
      listKind = 'commands';
      listRows = input.suggestions;
    } else if (commandPanelShown && input.findWords && input.found > 0) {
      listKind = 'found';
      listRows = input.found;
    }
  } else if (!locked) {
    if (input.askSources !== null) {
      if (input.askSources > 0) {
        listKind = 'sources';
        listRows = input.askSources;
      }
    } else if (input.recent > 0) {
      listKind = 'entries';
      listRows = input.recent;
    }
  }
  const { highlight } = input;
  const picked = listKind !== null && highlight !== null && highlight < listRows ? highlight : null;
  return {
    lockFree,
    needsUnlock,
    commandPanelShown,
    listKind,
    listRows,
    picked,
    lit: picked ?? (listKind === 'commands' ? 0 : null),
  };
}
