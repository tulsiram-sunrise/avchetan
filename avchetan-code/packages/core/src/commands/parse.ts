import { COMMAND_NAMES, type CommandName, isCommandName } from './registry';

export const COMMAND_PREFIX = '/';

/** Learned aliases: a word that means a command (`finish` → `done`). */
export type CommandAliases = Readonly<Record<string, CommandName>>;

export type ParsedCommand = {
  /** The first word as typed after `/`, lowercased; empty for a bare `/`. */
  word: string;
  /** Everything after the first word, trimmed. */
  text: string;
  /** The text after `/`, trimmed: what the AI reads when the word is no command. */
  input: string;
  /** The command the word names, directly or through a learned alias. */
  command: CommandName | null;
  viaAlias: boolean;
};

/** A line starting with `/`, but not `//` (which saves an entry starting with `/`). */
export function isCommand(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith(COMMAND_PREFIX) && !trimmed.startsWith(COMMAND_PREFIX.repeat(2));
}

/** What to save for a line that isn't a command: `//note` is saved as `/note`. */
export function captureText(text: string): string {
  const trimmed = text.trimStart();
  return trimmed.startsWith(COMMAND_PREFIX.repeat(2)) ? trimmed.slice(1) : text;
}

export function parseCommand(text: string, aliases: CommandAliases = {}): ParsedCommand | null {
  if (!isCommand(text)) return null;
  const input = text.trimStart().slice(COMMAND_PREFIX.length).trim();
  const match = /^(\S*)\s*([\s\S]*)$/.exec(input);
  const word = (match?.[1] ?? '').toLowerCase();
  const rest = (match?.[2] ?? '').trim();
  if (isCommandName(word)) return { word, text: rest, input, command: word, viaAlias: false };
  const aliased = Object.hasOwn(aliases, word) ? aliases[word] : undefined;
  if (aliased) return { word, text: rest, input, command: aliased, viaAlias: true };
  return { word, text: rest, input, command: null, viaAlias: false };
}

/** Commands whose name starts with what was typed so far, for the list under the box. */
export function suggestCommands(word: string): CommandName[] {
  return COMMAND_NAMES.filter((name) => name.startsWith(word.toLowerCase()));
}
