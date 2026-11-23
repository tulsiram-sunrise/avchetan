import { AppError, createLogger, LlmError } from '@avchetan/shared';
import { type CommandReading, interpretCommand } from '../commands/interpret';
import { loadCommandLearning } from '../commands/learning';
import { isCommandName } from '../commands/registry';
import { loadAnalysisMode, loadAnalysisModel } from '../extraction/settings';
import { llmDepsFor } from '../llm/llm-deps';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import type { DeviceDeps } from './device-deps';

const log = createLogger('commands');

/** The hub reads it (feature audit bug 4); a command this device doesn't know counts as none. */
async function readOnHub(deps: DeviceDeps, input: string): Promise<CommandReading> {
  const { store, platform, hub, words } = deps;
  if (!platform.network.isOnline()) {
    throw new LlmError(
      'llm_unavailable',
      `This ${words.device} is offline, so your hub can’t read this command`,
    );
  }
  const { examples } = await loadCommandLearning(store);
  const { command, text } = await hub.command({ input, examples });
  log.info('command read by the hub', { command: command ?? 'none' });
  if (command === null || !isCommandName(command)) {
    throw new AppError('command_unknown', 'Couldn’t read this as a command');
  }
  return { command, text: text.trim() };
}

/**
 * Asks which command the text means: the hub's model when the hub answers this device's
 * questions, else its answers model (or its organizing model). Only the text, the command list
 * and past confirmed readings are sent (docs/product/command-mode.md).
 */
export async function readCommand(deps: DeviceDeps, input: string): Promise<CommandReading> {
  const { store, platform, words } = deps;
  if ((await loadAnalysisMode(store)) === 'hub') return readOnHub(deps, input);
  const model = await loadAnalysisModel(store);
  if (!model) {
    throw new LlmError('llm_auth', `Reading commands needs a model in ${words.modelsPlace}`);
  }
  if (!platform.network.isOnline() && !PROVIDER_ADAPTERS[model.provider].local) {
    throw new LlmError(
      'llm_unavailable',
      `This ${words.device} is offline, so the AI can’t read this command`,
    );
  }
  const { examples } = await loadCommandLearning(store);
  const reading = await interpretCommand(
    input,
    { models: [model], examples },
    llmDepsFor(store, platform),
  );
  log.info('command read', { command: reading?.command ?? 'none' });
  if (!reading) throw new AppError('command_unknown', 'Couldn’t read this as a command');
  return reading;
}
