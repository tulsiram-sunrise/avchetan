import {
  type CommandName,
  type CommandPlan,
  type ParsedCommand,
  planSharedCommand,
  rankCommands,
  type SharedCommandDeps,
} from '@avchetan/core';
import type { Task } from '@avchetan/db/sqlite';

/** The commands the phone's capture box runs (§14 of tasks-routines-reminders.md). */
export const PHONE_COMMANDS = ['done', 'undo'] as const satisfies readonly CommandName[];
type PhoneCommand = (typeof PHONE_COMMANDS)[number];

const isPhoneCommand = (name: CommandName): name is PhoneCommand =>
  (PHONE_COMMANDS as readonly string[]).includes(name);

const PHONE_LIST = 'On the phone: /done and words from a task, or /undo';

/** Phone commands that fit what's typed after `/`, best first. */
export function phoneSuggestions(word: string): PhoneCommand[] {
  return rankCommands(word).filter(isPhoneCommand);
}

/** What the phone's command line does: core's shared handlers for the phone's commands. */
export function planPhoneCommand(
  deps: SharedCommandDeps,
  parsed: ParsedCommand,
  openTasks: readonly Task[],
): CommandPlan {
  if (parsed.command && isPhoneCommand(parsed.command)) {
    return planSharedCommand(deps, parsed.command, parsed.text, openTasks);
  }
  if (parsed.command) {
    return {
      kind: 'error',
      code: 'command_no_match',
      message: `/${parsed.command} is on the PC only for now. ${PHONE_LIST}`,
    };
  }
  if (!parsed.word) return { kind: 'hint', text: PHONE_LIST };
  if (phoneSuggestions(parsed.word).length > 0) return { kind: 'hint', text: 'Tap a command' };
  // The PC asks the AI to read an unknown command; the phone keeps to its two (§14).
  return { kind: 'error', code: 'command_no_match', message: `Not a command. ${PHONE_LIST}` };
}
