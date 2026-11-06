import { type ClientStore, getSetting, setSetting, type Tx } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { meaningfulWords } from '../normalize/words';
import type { CommandReading } from './interpret';
import type { CommandAliases } from './parse';
import { COMMAND_NAMES, isCommandName } from './registry';

/**
 * What confirmed AI readings teach (docs/product/command-mode.md): first-word aliases, used
 * without the AI, and recent readings as prompt examples. Client-local settings: command mode
 * is desktop-only, and these phrases are not log content to sync.
 */
export const COMMANDS_LEARN_SETTING = 'commands.learn';
export const COMMANDS_ALIASES_SETTING = 'commands.aliases';
export const COMMANDS_EXAMPLES_SETTING = 'commands.examples';

export const MAX_COMMAND_EXAMPLES = 20;

const commandName = z.enum(COMMAND_NAMES);
const aliasesSchema = z.record(z.string(), commandName);
const exampleSchema = z.object({ input: z.string(), command: commandName, text: z.string() });
export type LearnedCommandExample = z.infer<typeof exampleSchema>;

export type CommandLearning = {
  learn: boolean;
  aliases: CommandAliases;
  /** Newest first. */
  examples: LearnedCommandExample[];
};

export async function loadCommandLearning(store: ClientStore): Promise<CommandLearning> {
  const [learn, aliases, examples] = await Promise.all([
    getSetting(store.db, COMMANDS_LEARN_SETTING),
    getSetting(store.db, COMMANDS_ALIASES_SETTING),
    getSetting(store.db, COMMANDS_EXAMPLES_SETTING),
  ]);
  const parsedLearn = z.boolean().safeParse(learn);
  const parsedAliases = aliasesSchema.safeParse(aliases ?? {});
  const parsedExamples = z.array(exampleSchema).safeParse(examples ?? []);
  return {
    learn: parsedLearn.success ? parsedLearn.data : true,
    aliases: parsedAliases.success ? parsedAliases.data : {},
    examples: parsedExamples.success ? parsedExamples.data : [],
  };
}

async function save(store: ClientStore, write: (tx: Tx, now: string) => Promise<void>) {
  await store.write((tx) => write(tx, store.clock.now()));
}

export function saveCommandLearn(store: ClientStore, on: boolean): Promise<void> {
  return save(store, (tx, now) => setSetting(tx, COMMANDS_LEARN_SETTING, on, now));
}

/**
 * Remembers a reading the person confirmed. The first word becomes an alias when it isn't a
 * command already and the reading's text comes from the rest of the input, so `/<word> <rest>`
 * can later run as that command with `<rest>` and no AI call.
 */
export async function learnFromReading(
  store: ClientStore,
  input: string,
  reading: CommandReading,
): Promise<{ alias: string | null }> {
  const current = await loadCommandLearning(store);
  if (!current.learn) return { alias: null };
  const [first = '', ...restWords] = input.trim().split(/\s+/);
  const word = first.toLowerCase();
  const rest = meaningfulWords(restWords.join(' '));
  const textFromRest = [...meaningfulWords(reading.text)].every((w) => rest.has(w));
  const alias =
    /^[\p{L}\p{N}-]+$/u.test(word) &&
    !isCommandName(word) &&
    !Object.hasOwn(current.aliases, word) &&
    textFromRest
      ? word
      : null;
  const example = { input: input.trim(), command: reading.command, text: reading.text };
  const examples = [
    example,
    ...current.examples.filter((known) => known.input !== example.input),
  ].slice(0, MAX_COMMAND_EXAMPLES);
  await save(store, async (tx, now) => {
    await setSetting(tx, COMMANDS_EXAMPLES_SETTING, examples, now);
    if (alias) {
      await setSetting(
        tx,
        COMMANDS_ALIASES_SETTING,
        { ...current.aliases, [alias]: reading.command },
        now,
      );
    }
  });
  return { alias };
}

export async function forgetCommandAlias(store: ClientStore, word: string): Promise<void> {
  const { aliases } = await loadCommandLearning(store);
  const { [word]: _forgotten, ...rest } = aliases;
  await save(store, (tx, now) => setSetting(tx, COMMANDS_ALIASES_SETTING, rest, now));
}

export async function forgetCommandExample(store: ClientStore, input: string): Promise<void> {
  const { examples } = await loadCommandLearning(store);
  await save(store, (tx, now) =>
    setSetting(
      tx,
      COMMANDS_EXAMPLES_SETTING,
      examples.filter((example) => example.input !== input),
      now,
    ),
  );
}
