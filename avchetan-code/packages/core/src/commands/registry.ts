/**
 * Commands for the capture box's `/` mode (docs/product/command-mode.md). The registry is the
 * single list: the dock's suggestions and the AI prompt are built from it, and the desktop app
 * gives each a handler. Every command takes free text after its name (possibly empty).
 */
export const COMMANDS = {
  done: {
    usage: '/done <words>',
    help: 'Mark the open task that best matches the words as done',
    takesText: true,
  },
  find: {
    usage: '/find <words>',
    help: 'Find entries with these words; Enter opens Search',
    takesText: true,
  },
  brief: {
    usage: '/brief',
    help: "Make today's daily brief now",
    takesText: false,
  },
  sync: {
    usage: '/sync',
    help: 'Sync with your hub or server now',
    takesText: false,
  },
  undo: {
    usage: '/undo',
    help: 'Undo the last entry saved here, or the last command that changed something',
    takesText: false,
  },
  settings: {
    usage: '/settings <tab>',
    help: 'Open Settings, or one tab: ai, capture, voice, brief, privacy, hub, data, general',
    takesText: true,
  },
  lock: {
    usage: '/lock',
    help: 'Lock Avchetan now (app lock)',
    takesText: false,
  },
  unlock: {
    usage: '/unlock',
    help: 'Unlock Avchetan with Windows Hello',
    takesText: false,
  },
} as const;

/** Commands that work while the app is locked: they show nothing written before (app-lock.md). */
export const LOCK_FREE_COMMANDS: ReadonlySet<CommandName> = new Set(['lock', 'unlock', 'settings']);

export type CommandName = keyof typeof COMMANDS;
export const COMMAND_NAMES = Object.keys(COMMANDS) as [CommandName, ...CommandName[]];

export function isCommandName(word: string): word is CommandName {
  return Object.hasOwn(COMMANDS, word);
}
