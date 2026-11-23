import type { RawLog, Task } from '@avchetan/db/sqlite';
import type { LocalDate } from '@avchetan/shared';
import { runWrite, type WriteContext } from '../writes/actions';
import { matchOpenTask } from './match';
import type { CommandName } from './registry';
import type { UndoStack } from './undo';

/** What a command did, and how to take it back when it changed something. */
export type CommandOutcome = { message: string; undo: (() => Promise<string>) | null };

/** What Enter does for the current text (docs/product/command-mode.md). */
export type CommandPlan =
  /** Enter does nothing yet; the line says why. */
  | { kind: 'hint'; text: string }
  | { kind: 'run'; label: string; run: () => Promise<CommandOutcome> }
  /** Several tasks match equally: ↑↓ picks, Enter runs the picked one. */
  | {
      kind: 'choose';
      label: string;
      /** `key`: the task's ID, as two tasks can share a title. */
      options: { key: string; label: string; run: () => Promise<CommandOutcome> }[];
    }
  /** Not a command: Enter asks the AI to read it. */
  | { kind: 'ask_ai'; input: string }
  | { kind: 'error'; code: string; message: string };

/** How a sync ended, as `@avchetan/sync` names it; the app passes its state through. */
export type SyncOutcome =
  | 'synced'
  | 'syncing'
  | 'not_configured'
  | 'offline'
  | 'unauthorized'
  | 'server_unreachable'
  | 'wrong_server'
  | 'failed';

/** What the commands both apps share need from the device. */
export type SharedCommandDeps = {
  /** The shared writes, with the device's today. */
  write: WriteContext;
  /** For messages: `PC` or `phone`, and where its sync settings are. */
  words: { device: string; syncPlace: string };
  today: () => LocalDate;
  makeBrief: (day: LocalDate) => Promise<'made' | 'empty'>;
  /** Syncs now and returns the state it ended in. */
  syncNow: () => Promise<SyncOutcome>;
  openDays: () => Promise<void>;
  /** Opens Search with the words (`/find`). */
  openSearch: (text: string) => Promise<void>;
  /** After a write: refresh what's shown and queue a sync. */
  changed: () => void;
  undo: UndoStack;
};

/** The commands whose handlers live here; the rest (`settings`, `lock`, `unlock`) are per app. */
export const SHARED_COMMANDS = ['done', 'find', 'brief', 'sync', 'undo'] as const;
export type SharedCommandName = (typeof SHARED_COMMANDS)[number];

export function isSharedCommand(name: CommandName): name is SharedCommandName {
  return (SHARED_COMMANDS as readonly string[]).includes(name);
}

/** A short quote of an entry for the undo line; only its owner sees the capture box. */
function quote(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return `“${line.length > 40 ? `${line.slice(0, 40)}…` : line}”`;
}

/**
 * An entry just saved from the capture box joins the undo list, so `/undo` can take it back. The
 * delete is a soft delete through the repository, with whatever the AI made from the entry.
 */
export function rememberCapture(
  deps: Pick<SharedCommandDeps, 'write' | 'changed' | 'undo'>,
  rawLog: Pick<RawLog, 'id' | 'content'>,
): void {
  const shown = quote(rawLog.content);
  deps.undo.push({
    label: `delete ${shown}`,
    undo: async () => {
      await runWrite(deps.write, 'log.delete', { id: rawLog.id });
      deps.changed();
      return `Deleted: ${shown}`;
    },
  });
}

function doneTask(deps: SharedCommandDeps, task: Task): () => Promise<CommandOutcome> {
  return async () => {
    await runWrite(deps.write, 'task.setDone', { id: task.id, done: true });
    deps.changed();
    const undo = async () => {
      await runWrite(deps.write, 'task.setDone', { id: task.id, done: false });
      deps.changed();
      return `Reopened: ${task.title}`;
    };
    deps.undo.push({ label: `reopen “${task.title}”`, undo });
    return { message: `Done: ${task.title}`, undo };
  };
}

function syncMessage(
  state: SyncOutcome,
  { device, syncPlace }: SharedCommandDeps['words'],
): string {
  switch (state) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing…';
    case 'not_configured':
      return `This ${device} isn’t connected to a hub or server, so there’s nothing to sync`;
    case 'offline':
      return `This ${device} is offline; it syncs when it’s back`;
    case 'unauthorized':
      return `Your hub or server refused this ${device}’s sync token`;
    case 'server_unreachable':
      return 'Can’t reach your hub or server';
    case 'wrong_server':
      return `A different server answered at this ${device}’s hub address. Pair again`;
    case 'failed':
      return `Sync failed; ${syncPlace} says why`;
  }
}

/** The plan for one of the shared commands and its text. */
export function planSharedCommand(
  deps: SharedCommandDeps,
  command: SharedCommandName,
  text: string,
  openTasks: readonly Task[],
): CommandPlan {
  switch (command) {
    case 'done': {
      if (!text) return { kind: 'hint', text: 'Type words from the task to mark done' };
      const match = matchOpenTask(text, openTasks);
      if (match.kind === 'none') {
        return {
          kind: 'error',
          code: 'command_no_match',
          message: `No open task matches “${text}”`,
        };
      }
      if (match.kind === 'one') {
        return { kind: 'run', label: `Done: ${match.task.title}`, run: doneTask(deps, match.task) };
      }
      return {
        kind: 'choose',
        label: 'Several tasks match. ↑↓ to pick, Enter to mark it done',
        options: match.tasks.map((task) => ({
          key: task.id,
          label: task.title,
          run: doneTask(deps, task),
        })),
      };
    }
    case 'find': {
      if (!text) return { kind: 'hint', text: 'Type words to find' };
      return {
        kind: 'run',
        label: 'Open Search with these words',
        async run() {
          await deps.openSearch(text);
          return { message: 'Opened Search', undo: null };
        },
      };
    }
    case 'brief':
      return {
        kind: 'run',
        label: 'Make today’s daily brief and open it in Days',
        async run() {
          const status = await deps.makeBrief(deps.today());
          await deps.openDays();
          return {
            message:
              status === 'made'
                ? 'Today’s brief is ready'
                : 'Today has no entries yet, so no brief',
            undo: null,
          };
        },
      };
    case 'sync':
      return {
        kind: 'run',
        label: 'Sync now',
        run: async () => ({ message: syncMessage(await deps.syncNow(), deps.words), undo: null }),
      };
    case 'undo': {
      const top = deps.undo.peek();
      if (!top) return { kind: 'hint', text: 'Nothing to undo since Avchetan started' };
      const stack = deps.undo;
      return {
        kind: 'run',
        label: `Undo: ${top.label}`,
        // The change the label names, even if another one was made since the line was shown.
        async run() {
          const message = await stack.run(top);
          return { message: message ?? 'Already undone', undo: null };
        },
      };
    }
  }
}
