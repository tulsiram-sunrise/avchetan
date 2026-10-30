import type { ClientStore, ExtractionPlan, RawLog } from '@avchetan/db/sqlite';
import { generateStructured, type LlmDeps } from '../llm/generate-structured';
import * as prompt from '../prompts/extraction.v1';
import type { ModelConfig } from '../providers/config';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import { buildExtractionInput, type ExtractionVocabulary } from './input';
import { type LlmMayCreate, normalizeExtraction } from './normalize';
import { extractionResultSchema } from './schema';

export const EXTRACTION_PROMPT_VERSION = prompt.version;

export type ExtractionOptions = {
  /** The extraction slot's model, then its fallbacks. */
  models: readonly ModelConfig[];
  vocabulary: ExtractionVocabulary;
  llmMayCreate: LlmMayCreate;
};

/** A `!private` entry only ever goes to a model on the user's own hardware. */
function modelsAllowedFor(rawLog: RawLog, models: readonly ModelConfig[]): readonly ModelConfig[] {
  if (rawLog.privacy === 'normal') return models;
  return models.filter((model) => PROVIDER_ADAPTERS[model.provider].local);
}

const emptyPlan = (rawLog: RawLog): ExtractionPlan => ({
  rawLogId: rawLog.id,
  status: 'skipped',
  model: null,
  version: null,
  activities: [],
  tasks: [],
  logTagPaths: [],
  entities: [],
  newCategory: null,
  categorySuggestion: null,
});

/** Runs the model and normalizes its answer. Writes nothing, except the `llm_runs` audit. */
export async function extractRawLog(
  rawLog: RawLog,
  { models, vocabulary, llmMayCreate }: ExtractionOptions,
  llm: LlmDeps,
): Promise<ExtractionPlan> {
  const allowed = modelsAllowedFor(rawLog, models);
  if (rawLog.privacy !== 'normal' && allowed.length === 0) return emptyPlan(rawLog);

  const { output, provider, model } = await generateStructured(
    {
      purpose: 'extraction',
      rawLogId: rawLog.id,
      models: allowed,
      schema: extractionResultSchema,
      system: prompt.system,
      prompt: prompt.buildUser(buildExtractionInput(rawLog, vocabulary)),
    },
    llm,
  );
  return normalizeExtraction(output, {
    rawLog,
    vocabulary,
    llmMayCreate,
    model: `${provider}:${model}`,
    version: EXTRACTION_PROMPT_VERSION,
  });
}

/** Extracts one log and applies the result. Returns false if the log was deleted meanwhile. */
export async function processRawLog(
  store: ClientStore,
  rawLog: RawLog,
  options: ExtractionOptions,
  llm: LlmDeps,
): Promise<boolean> {
  const plan = await extractRawLog(rawLog, options, llm);
  return store.write((tx) => store.repos.extraction.apply(tx, plan));
}
