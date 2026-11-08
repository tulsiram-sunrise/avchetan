import { interpretCommand, type LlmDeps, type ModelConfig } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import type { HubCommandRequestParsed, HubCommandResponse } from '@avchetan/sync/protocol';

const log = createLogger('command');

/**
 * Reads what a device typed after `/` as one of the app's commands, with the hub's answers
 * model (docs/product/command-mode.md). It gets only the typed words and the device's earlier
 * confirmed readings; it never reads entries, so it needs no device copy.
 */
export function createHubCommand(options: { model: ModelConfig; llm: LlmDeps }) {
  return async (request: HubCommandRequestParsed): Promise<HubCommandResponse> => {
    const reading = await interpretCommand(
      request.input,
      { models: [options.model], examples: request.examples },
      options.llm,
    );
    log.info('command read', { command: reading?.command ?? 'none' });
    return reading ? { command: reading.command, text: reading.text } : { command: null, text: '' };
  };
}
