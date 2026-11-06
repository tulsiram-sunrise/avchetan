import {
  type CommandName,
  type CommandReading,
  createModel,
  interpretCommand,
  learnFromReading,
  loadAnalysisModel,
  loadCommandLearning,
  matchOpenTask,
  type ParsedCommand,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import type { ClientStore, Task } from '@avchetan/db/sqlite';
import { AppError, createLogger, LlmError, type LocalDate, localDate } from '@avchetan/shared';
import { loadSyncStatus, type SyncState } from '@avchetan/sync';
import type { AppServices } from '../app-services';
import { announce } from './extraction';

const log = createLogger('commands');

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
      options: { label: string; run: () => Promise<CommandOutcome> }[];
    }
  /** Not a command: Enter asks the AI to read it. */
  | { kind: 'ask_ai'; input: string }
  | { kind: 'error'; code: string; message: string };

/** Undo for this session of the capture box. */
export type UndoStack = {
  push(entry: { label: string; undo: () => Promise<string> }): void;
  pop(): { label: string; undo: () => Promise<string> } | undefined;
  readonly size: number;
};

const MAX_UNDO = 20;

export function createUndoStack(): UndoStack {
  const entries: { label: string; undo: () => Promise<string> }[] = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > MAX_UNDO) entries.shift();
    },
    pop: () => entries.pop(),
    get size() {
      return entries.length;
    },
  };
}

export type CommandDeps = {
  store: ClientStore;
  today: () => LocalDate;
  makeBrief: (day: LocalDate) => Promise<'made' | 'empty'>;
  /** Syncs now and returns the state it ended in. */
  syncNow: () => Promise<SyncState>;
  openDays: () => Promise<void>;
  /** After a write: refresh the windows and queue a sync. */
  changed: () => void;
  undo: UndoStack;
};

export function commandDeps(services: AppServices, undo: UndoStack): CommandDeps {
  const { store, platform, timeZone, sync, brief } = services;
  return {
    store,
    today: () => localDate(store.clock.now(), timeZone.current()),
    makeBrief: (day) => brief.makeNow(day),
    async syncNow() {
      await sync.syncNow();
      return (await loadSyncStatus(store)).state;
    },
    openDays: async () => {
      await platform.shell.openMain('timeline');
    },
    changed() {
      void announce(store, platform);
      sync.schedule();
    },
    undo,
  };
}

function doneTask(deps: CommandDeps, task: Task): () => Promise<CommandOutcome> {
  return async () => {
    const { store } = deps;
    await store.write((tx) => store.repos.tasks.complete(tx, task.id));
    deps.changed();
    const undo = async () => {
      await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
      deps.changed();
      return `Reopened: ${task.title}`;
    };
    deps.undo.push({ label: `Done: ${task.title}`, undo });
    return { message: `Done: ${task.title}`, undo };
  };
}

const SYNC_MESSAGES: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing…',
  not_configured: 'This PC isn’t connected to a hub or server, so there’s nothing to sync',
  offline: 'This PC is offline; it syncs when it’s back',
  unauthorized: 'Your hub or server refused this PC’s sync token',
  server_unreachable: 'Can’t reach your hub or server',
  failed: 'Sync failed; Settings → Sync says why',
};

/** The plan for a known command and its text. */
export function planFor(
  deps: CommandDeps,
  command: CommandName,
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
        options: match.tasks.map((task) => ({ label: task.title, run: doneTask(deps, task) })),
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
        run: async () => ({ message: SYNC_MESSAGES[await deps.syncNow()], undo: null }),
      };
    case 'undo': {
      const last = deps.undo.size > 0 ? deps.undo.pop.bind(deps.undo) : null;
      if (!last) return { kind: 'hint', text: 'Nothing to undo' };
      return {
        kind: 'run',
        label: 'Undo the last command',
        async run() {
          const entry = last();
          if (!entry) return { message: 'Nothing to undo', undo: null };
          return { message: await entry.undo(), undo: null };
        },
      };
    }
  }
}

/** What Enter does for parsed text. */
export function planCommand(
  deps: CommandDeps,
  parsed: ParsedCommand,
  openTasks: readonly Task[],
): CommandPlan {
  if (parsed.command) return planFor(deps, parsed.command, parsed.text, openTasks);
  if (!parsed.input) return { kind: 'hint', text: 'Type a command' };
  return { kind: 'ask_ai', input: parsed.input };
}

/**
 * Asks this PC's answers model (else its organizing model) which command the text means. Only
 * the text, the command list and past confirmed readings are sent (docs/product/command-mode.md).
 */
export async function readCommand(services: AppServices, input: string): Promise<CommandReading> {
  const { store, platform } = services;
  const model = await loadAnalysisModel(store);
  if (!model) {
    throw new LlmError('llm_auth', 'Reading commands needs a model in Settings → AI models');
  }
  if (!platform.network.isOnline() && !PROVIDER_ADAPTERS[model.provider].local) {
    throw new LlmError('llm_unavailable', 'This PC is offline, so the AI can’t read this command');
  }
  const { examples } = await loadCommandLearning(store);
  const reading = await interpretCommand(
    input,
    { models: [model], examples },
    {
      resolveModel: (config) => createModel(config, platform),
      recordRun: (run) => store.recordLlmRun(run),
    },
  );
  log.info('command read', { command: reading?.command ?? 'none' });
  if (!reading) throw new AppError('command_unknown', 'Couldn’t read this as a command');
  return reading;
}

/** Runs a confirmed AI reading's plan, then learns from it. */
export async function confirmReading(
  store: ClientStore,
  input: string,
  reading: CommandReading,
  run: () => Promise<CommandOutcome>,
): Promise<CommandOutcome & { alias: string | null }> {
  const outcome = await run();
  const { alias } = await learnFromReading(store, input, reading);
  return { ...outcome, alias };
}
