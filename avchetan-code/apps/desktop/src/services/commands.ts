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
import type { ClientStore, RawLog, Task } from '@avchetan/db/sqlite';
import {
  AppError,
  createLogger,
  LlmError,
  type LocalDate,
  localDate,
  type UnlockOutcome,
} from '@avchetan/shared';
import { loadSyncStatus, type SyncState } from '@avchetan/sync';
import type { AppServices } from '../app-services';
import { SETTINGS_TABS, type SettingsTab, saveSettingsTab } from '../main-window/settings-tabs';
import { emitAppEvent } from '../native/events';
import type { LockStatus } from '../native/lock';
import { unlockApp } from './app-lock';
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
  /** `label` says what undoing does, e.g. `reopen “Call the plumber”`. */
  push(entry: { label: string; undo: () => Promise<string> }): void;
  pop(): { label: string; undo: () => Promise<string> } | undefined;
  peek(): { label: string; undo: () => Promise<string> } | undefined;
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
    peek: () => entries.at(-1),
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
  /** The app lock (src-tauri/src/app_lock.rs). */
  lock: {
    status(): Promise<LockStatus>;
    unlock(): Promise<UnlockOutcome>;
    lockNow(): Promise<LockStatus>;
  };
  /** Opens the main window on Settings, on `tab` when given. */
  openSettings: (tab: SettingsTab | null) => Promise<void>;
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
    lock: {
      status: () => platform.lock.status(),
      unlock: () => unlockApp(store, platform.lock, 'Unlock Avchetan'),
      lockNow: () => platform.lock.lockNow(),
    },
    async openSettings(tab) {
      // The tab is remembered in storage both windows share, for a main window not created yet.
      if (tab) saveSettingsTab(tab);
      await platform.shell.openMain('settings');
      if (tab) await emitAppEvent('main:navigate', { view: 'settings', tab });
    },
  };
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
  deps: Pick<CommandDeps, 'store' | 'changed' | 'undo'>,
  rawLog: Pick<RawLog, 'id' | 'content'>,
): void {
  const shown = quote(rawLog.content);
  deps.undo.push({
    label: `delete ${shown}`,
    undo: async () => {
      await deps.store.write((tx) => deps.store.repos.rawLogs.softDelete(tx, rawLog.id));
      deps.changed();
      return `Deleted: ${shown}`;
    },
  });
}

const TAB_ALIASES: Record<string, SettingsTab> = {
  lock: 'privacy',
  sync: 'hub',
  shortcut: 'capture',
  commands: 'capture',
  models: 'ai',
};

/** The tab `/settings <words>` means: a tab's id, or the start of a word in its name. */
export function settingsTabFor(text: string): SettingsTab | null | 'unknown' {
  const word = text.trim().toLowerCase();
  if (!word) return null;
  const alias = TAB_ALIASES[word];
  if (alias) return alias;
  const tab = SETTINGS_TABS.find(
    (item) =>
      item.id.startsWith(word) ||
      item.label
        .toLowerCase()
        .split(/[\s&]+/)
        .some((part) => part.length > 0 && part.startsWith(word)),
  );
  return tab ? tab.id : 'unknown';
}

const LOCK_OFF = 'The app lock is off. Turn it on with /settings privacy';

const UNLOCK_MESSAGES: Record<UnlockOutcome, string> = {
  verified: 'Unlocked',
  cancelled: 'Still locked',
  failed: 'Windows Hello didn’t work this time. Try again',
  unavailable: 'Windows Hello isn’t set up on this PC any more, so the app lock is now off',
};

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
    deps.undo.push({ label: `reopen “${task.title}”`, undo });
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
  failed: 'Sync failed; Settings → Hub & sync → Sync says why',
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
      const top = deps.undo.peek();
      if (!top) return { kind: 'hint', text: 'Nothing to undo since Avchetan started' };
      const last = deps.undo.pop.bind(deps.undo);
      return {
        kind: 'run',
        label: `Undo: ${top.label}`,
        async run() {
          const entry = last();
          if (!entry) return { message: 'Nothing to undo', undo: null };
          return { message: await entry.undo(), undo: null };
        },
      };
    }
    case 'settings': {
      const tab = settingsTabFor(text);
      if (tab === 'unknown') {
        const ids = SETTINGS_TABS.map((item) => item.id).join(', ');
        return {
          kind: 'error',
          code: 'command_no_match',
          message: `No Settings tab called “${text}”. Try: ${ids}`,
        };
      }
      const label = tab ? SETTINGS_TABS.find((item) => item.id === tab)?.label : null;
      const where = label ? `Settings → ${label}` : 'Settings';
      return {
        kind: 'run',
        label: `Open ${where}`,
        async run() {
          await deps.openSettings(tab);
          return { message: `Opened ${where}`, undo: null };
        },
      };
    }
    case 'lock':
      return {
        kind: 'run',
        label: 'Lock Avchetan now',
        async run() {
          const status = await deps.lock.status();
          if (!status.enabled) return { message: LOCK_OFF, undo: null };
          await deps.lock.lockNow();
          return { message: 'Locked', undo: null };
        },
      };
    case 'unlock':
      return {
        kind: 'run',
        label: 'Unlock with Windows Hello',
        async run() {
          const status = await deps.lock.status();
          if (!status.enabled) return { message: LOCK_OFF, undo: null };
          if (!status.locked) return { message: 'Avchetan is already unlocked', undo: null };
          return { message: UNLOCK_MESSAGES[await deps.lock.unlock()], undo: null };
        },
      };
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
    throw new LlmError('llm_auth', 'Reading commands needs a model in Settings → AI → AI models');
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
