import type { ClientStore, ExtractionPlan, RawLog } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import {
  generateStructured,
  type LlmDeps,
  type StructuredRequest,
} from '../llm/generate-structured';
import * as prompt from '../prompts/extraction.v9';
import type { ModelConfig } from '../providers/config';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import { chooseExamples, dropCopiedItems } from './corrections';
import {
  buildExtractionInput,
  type ChoreChoice,
  type ExtractionVocabulary,
  loadOpenChores,
} from './input';
import { type LlmMayCreate, normalizeExtraction } from './normalize';
import { type ExtractionResult, extractionResultSchema } from './schema';

export const EXTRACTION_PROMPT_VERSION = prompt.version;

const log = createLogger('extraction');

export type ExtractionOptions = {
  /** The extraction slot's model, then its fallbacks. */
  models: readonly ModelConfig[];
  vocabulary: ExtractionVocabulary;
  llmMayCreate: LlmMayCreate;
  /** The open chores on the entry's day; `processRawLog` loads them when left out. */
  chores?: readonly ChoreChoice[];
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
  choreTicks: [],
});

/** The model call for one log. The eval uses this directly, to see the raw answer. */
export function extractionRequest(
  rawLog: RawLog,
  models: readonly ModelConfig[],
  vocabulary: ExtractionVocabulary,
  chores: readonly ChoreChoice[] = [],
): StructuredRequest<ExtractionResult> {
  return {
    purpose: 'extraction',
    rawLogId: rawLog.id,
    models,
    schema: extractionResultSchema,
    system: prompt.system,
    prompt: prompt.buildUser(buildExtractionInput(rawLog, vocabulary, chores)),
  };
}

/** Runs the model and normalizes its answer. Writes nothing, except the `llm_runs` audit. */
export async function extractRawLog(
  rawLog: RawLog,
  { models, vocabulary, llmMayCreate, chores = [] }: ExtractionOptions,
  llm: LlmDeps,
): Promise<ExtractionPlan> {
  const allowed = modelsAllowedFor(rawLog, models);
  if (rawLog.privacy !== 'normal' && allowed.length === 0) return emptyPlan(rawLog);

  const { output, provider, model } = await generateStructured(
    extractionRequest(rawLog, allowed, vocabulary, chores),
    llm,
  );
  const examples = chooseExamples(rawLog.content, rawLog.id, vocabulary.corrections);
  const { result, dropped } = dropCopiedItems(output, rawLog.content, examples);
  if (dropped > 0) log.info('dropped items copied from examples', { id: rawLog.id, dropped });
  return normalizeExtraction(result, {
    rawLog,
    vocabulary,
    llmMayCreate,
    model: `${provider}:${model}`,
    version: EXTRACTION_PROMPT_VERSION,
    chores,
  });
}

/** Extracts one log and applies the result. Returns false if the log was deleted meanwhile. */
export async function processRawLog(
  store: ClientStore,
  rawLog: RawLog,
  options: ExtractionOptions,
  llm: LlmDeps,
): Promise<boolean> {
  const chores = options.chores ?? (await loadOpenChores(store, rawLog));
  const plan = await extractRawLog(rawLog, { ...options, chores }, llm);
  return store.write((tx) => store.repos.extraction.apply(tx, plan));
}
