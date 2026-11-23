/** One change that can be taken back. `label` says what undoing does: `reopen “Call the plumber”`. */
export type UndoEntry = { label: string; undo: () => Promise<string> };

/**
 * The changes `/undo` can take back on a device, newest last: commands that changed something
 * and entries saved from the capture box, for as long as the app runs (command-mode.md).
 */
export type UndoStack = {
  push(entry: UndoEntry): void;
  peek(): UndoEntry | undefined;
  /** The entry whose undo is this function: the one a result's Undo button belongs to. */
  find(undo: UndoEntry['undo']): UndoEntry | undefined;
  /**
   * Undoes this entry and only then takes it off the list: an undo that fails stays, to try
   * again. Undefined when it was already undone.
   */
  run(entry: UndoEntry): Promise<string | undefined>;
  readonly size: number;
};

export const MAX_UNDO = 20;

export function createUndoStack(): UndoStack {
  const entries: UndoEntry[] = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > MAX_UNDO) entries.shift();
    },
    peek: () => entries.at(-1),
    find: (undo) => entries.find((entry) => entry.undo === undo),
    async run(entry) {
      if (!entries.includes(entry)) return undefined;
      const message = await entry.undo();
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      return message;
    },
    get size() {
      return entries.length;
    },
  };
}
