import { z } from 'zod';
import { generateStructured, type LlmDeps } from '../llm/generate-structured';
import * as prompt from '../prompts/command.v1';
import type { ModelConfig } from '../providers/config';
import { COMMAND_NAMES, type CommandName } from './registry';

const readingSchema = z.object({
  command: z.enum([...COMMAND_NAMES, 'none']),
  text: z.string(),
});

/** What the AI made of an unknown command: a registered command and its text. */
export type CommandReading = { command: CommandName; text: string };

/**
 * Asks the model which command `input` (the text after `/`) means. Only the input, the command
 * list and past confirmed readings are sent: never tasks or entries. Null when it means none.
 */
export async function interpretCommand(
  input: string,
  options: { models: readonly ModelConfig[]; examples: readonly prompt.CommandExample[] },
  llm: LlmDeps,
): Promise<CommandReading | null> {
  const { output } = await generateStructured(
    {
      purpose: 'analysis',
      models: options.models,
      schema: readingSchema,
      system: prompt.SYSTEM,
      prompt: prompt.buildPrompt(input, options.examples),
    },
    llm,
  );
  if (output.command === 'none') return null;
  return { command: output.command, text: output.text.trim() };
}
