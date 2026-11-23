import type { ClientStore } from '@avchetan/db/sqlite';
import { createModel, type ProviderDeps } from '../providers/registry';
import type { LlmDeps } from './generate-structured';

/**
 * How a device calls models: built with its own fetch and key store, and each call recorded in
 * its `llm_runs`. The one place apps wire this, instead of each service repeating it.
 */
export function llmDepsFor(
  store: Pick<ClientStore, 'recordLlmRun'>,
  { fetch, secrets }: ProviderDeps,
): LlmDeps {
  return {
    resolveModel: (config) => createModel(config, { fetch, secrets }),
    recordRun: (run) => store.recordLlmRun(run),
  };
}
