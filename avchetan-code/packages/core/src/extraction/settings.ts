import { EXTRACTION_MODES, type ExtractionMode } from '@avchetan/db';
import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { z } from 'zod';
import { extractionChain, type ModelConfig, modelSlotsSchema } from '../providers/config';
import { loadLearnFromCorrections } from './corrections';
import { LLM_MAY_CREATE_SETTING, type LlmMayCreate, llmMayCreateSchema } from './normalize';

const log = createLogger('extraction');

export const MODEL_SLOTS_SETTING = 'llm.slots';
/** Who organizes this device's entries: the device (`self`) or its hub (`delegate`). */
export const EXTRACTION_MODE_SETTING = 'extraction.mode';

export async function loadExtractionMode(store: ClientStore): Promise<ExtractionMode> {
  const mode = z
    .enum(EXTRACTION_MODES)
    .safeParse(await getSetting(store.db, EXTRACTION_MODE_SETTING));
  return mode.success ? mode.data : 'self';
}

/** Who answers this device's questions: its own model (`self`) or its hub (`hub`, ADR-0022). */
export const ANALYSIS_MODES = ['self', 'hub'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export const ANALYSIS_MODE_SETTING = 'analysis.mode';

export async function loadAnalysisMode(store: ClientStore): Promise<AnalysisMode> {
  const mode = z.enum(ANALYSIS_MODES).safeParse(await getSetting(store.db, ANALYSIS_MODE_SETTING));
  return mode.success ? mode.data : 'self';
}

export async function saveAnalysisMode(store: ClientStore, mode: AnalysisMode): Promise<void> {
  await store.write((tx) => setSetting(tx, ANALYSIS_MODE_SETTING, mode, store.clock.now()));
}

export async function saveExtractionMode(store: ClientStore, mode: ExtractionMode): Promise<void> {
  await store.write((tx) => setSetting(tx, EXTRACTION_MODE_SETTING, mode, store.clock.now()));
}

export type ExtractionSettings = {
  models: ModelConfig[];
  llmMayCreate: LlmMayCreate;
  /** Put the user's past corrections in the prompt as examples. */
  learnFromCorrections: boolean;
};

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
  // The hub organizes this device's entries, so it calls no model of its own.
  const delegated = (await loadExtractionMode(store)) === 'delegate';
  return {
    models: slots.success && !delegated ? extractionChain(slots.data) : [],
    llmMayCreate: mayCreate.success ? mayCreate.data : 'auto',
    learnFromCorrections: await loadLearnFromCorrections(store),
  };
}
