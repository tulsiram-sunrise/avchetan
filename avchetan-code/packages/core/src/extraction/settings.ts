import { type ClientStore, getSetting } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { extractionChain, type ModelConfig, modelSlotsSchema } from '../providers/config';
import { LLM_MAY_CREATE_SETTING, type LlmMayCreate, llmMayCreateSchema } from './normalize';

const log = createLogger('extraction');

export const MODEL_SLOTS_SETTING = 'llm.slots';

export type ExtractionSettings = { models: ModelConfig[]; llmMayCreate: LlmMayCreate };

/** The model that answers questions: its own slot, else the one that organizes entries. */
export async function loadAnalysisModel(store: ClientStore): Promise<ModelConfig | null> {
  const slots = modelSlotsSchema.safeParse((await getSetting(store.db, MODEL_SLOTS_SETTING)) ?? {});
  return slots.success ? (slots.data.analysis ?? slots.data.extraction ?? null) : null;
}

/** Read before every run, so a change in settings needs no restart. No slot means no models. */
export async function loadExtractionSettings(store: ClientStore): Promise<ExtractionSettings> {
  const slots = modelSlotsSchema.safeParse((await getSetting(store.db, MODEL_SLOTS_SETTING)) ?? {});
  if (!slots.success)
    log.warn('invalid model slots setting', { issues: slots.error.issues.length });
  const mayCreate = llmMayCreateSchema.safeParse(
    await getSetting(store.db, LLM_MAY_CREATE_SETTING),
  );
  return {
    models: slots.success ? extractionChain(slots.data) : [],
    llmMayCreate: mayCreate.success ? mayCreate.data : 'auto',
  };
}
