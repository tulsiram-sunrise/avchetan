import {
  type CommandName,
  type CommandOutcome,
  type CommandPlan,
  type CommandReading,
  isSharedCommand,
  learnFromReading,
  type ParsedCommand,
  planSharedCommand,
  type SharedCommandDeps,
  type UndoStack,
} from '@avchetan/core';
import type { ClientStore, Task } from '@avchetan/db/sqlite';
import { localDate, type UnlockOutcome } from '@avchetan/shared';
import { loadSyncStatus } from '@avchetan/sync';
import type { AppServices } from '../app-services';
import { SETTINGS_TABS, type SettingsTab, saveSettingsTab } from '../main-window/settings-tabs';
import { emitAppEvent } from '../native/events';
import type { LockStatus } from '../native/lock';
import { writeContext } from './actions';
import { unlockApp } from './app-lock';
import { announce } from './extraction';

/** Core's shared commands, plus the PC's own: `/settings`, `/lock`, `/unlock`. */
export type CommandDeps = SharedCommandDeps & {
  store: ClientStore;
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
    write: writeContext(store),
    words: { device: 'PC', syncPlace: 'Settings → Hub & sync → Sync' },
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
    async openSearch(text) {
      // The words go with the window, or its event when it is open: in memory, never on disk.
      await platform.shell.openMain('search', null, text);
    },
    async openSettings(tab) {
      // The tab is remembered in storage both windows share, for a main window not created yet.
      if (tab) saveSettingsTab(tab);
      await platform.shell.openMain('settings');
      if (tab) await emitAppEvent('main:navigate', { view: 'settings', tab });
    },
  };
}

const TAB_ALIASES: Record<string, SettingsTab> = {
  lock: 'privacy',
  sync: 'hub',
  shortcut: 'capture',
  commands: 'capture',
  models: 'ai',
};

/** Lowercase words, without `&` and other marks: "Hub & sync" → hub, sync. */
function tabWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0);
}

/**
 * The tab `/settings <words>` means: an alias, or a tab where every typed word starts its id or
 * a word of its name, in any case ("Hub & sync", "daily brief", "cap box").
 */
export function settingsTabFor(text: string): SettingsTab | null | 'unknown' {
  const typed = tabWords(text);
  if (typed.length === 0) return null;
  const alias = typed.length === 1 ? TAB_ALIASES[typed[0] as string] : undefined;
  if (alias) return alias;
  const tab = SETTINGS_TABS.find((item) => {
    const words = [item.id, ...tabWords(item.label)];
    return typed.every((word) => words.some((part) => part.startsWith(word)));
  });
  return tab ? tab.id : 'unknown';
}

const LOCK_OFF = 'The app lock is off. Turn it on with /settings privacy';

const UNLOCK_MESSAGES: Record<UnlockOutcome, string> = {
  verified: 'Unlocked',
  cancelled: 'Still locked',
  failed: 'Windows Hello didn’t work this time. Try again',
  unavailable: 'Windows Hello isn’t set up on this PC any more, so the app lock is now off',
};

/** The plan for a known command and its text. */
export function planFor(
  deps: CommandDeps,
  command: CommandName,
  text: string,
  openTasks: readonly Task[],
): CommandPlan {
  if (isSharedCommand(command)) return planSharedCommand(deps, command, text, openTasks);
  switch (command) {
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
