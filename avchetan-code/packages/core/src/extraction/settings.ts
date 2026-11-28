import { EXTRACTION_MODES, type ExtractionMode } from '@avchetan/db';
import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { extractionChain, type ModelConfig, modelSlotsSchema } from '../providers/config';
import { loadLearnFromCorrections } from './corrections';
import { LLM_MAY_CREATE_SETTING, type LlmMayCreate } from './normalize';

/** Which model does what on this device; no slot means no model. */
export const MODEL_SLOTS_SETTING = defineSetting(
  'llm.slots',
  modelSlotsSchema,
  modelSlotsSchema.parse({}),
);
/** Who organizes this device's entries: the device (`self`) or its hub (`delegate`). */
export const EXTRACTION_MODE_SETTING = defineSetting(
  'extraction.mode',
  z.enum(EXTRACTION_MODES),
  'self',
);

export async function loadExtractionMode(store: ClientStore): Promise<ExtractionMode> {
  return EXTRACTION_MODE_SETTING.load(store.db);
}

/** Who answers this device's questions: its own model (`self`) or its hub (`hub`, ADR-0022). */
export const ANALYSIS_MODES = ['self', 'hub'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export const ANALYSIS_MODE_SETTING = defineSetting('analysis.mode', z.enum(ANALYSIS_MODES), 'self');

export async function loadAnalysisMode(store: ClientStore): Promise<AnalysisMode> {
  return ANALYSIS_MODE_SETTING.load(store.db);
}

export async function saveAnalysisMode(store: ClientStore, mode: AnalysisMode): Promise<void> {
  await store.write((tx) => ANALYSIS_MODE_SETTING.save(tx, mode, store.clock.now()));
}

export async function saveExtractionMode(store: ClientStore, mode: ExtractionMode): Promise<void> {
  await store.write((tx) => EXTRACTION_MODE_SETTING.save(tx, mode, store.clock.now()));
}

export type ExtractionSettings = {
  models: ModelConfig[];
  llmMayCreate: LlmMayCreate;
  /** Put the user's past corrections in the prompt as examples. */
  learnFromCorrections: boolean;
};

/** The model that answers questions: its own slot, else the one that organizes entries. */
export async function loadAnalysisModel(store: ClientStore): Promise<ModelConfig | null> {
  const slots = await MODEL_SLOTS_SETTING.load(store.db);
  return slots.analysis ?? slots.extraction ?? null;
}

/** Read before every run, so a change in settings needs no restart. No slot means no models. */
export async function loadExtractionSettings(store: ClientStore): Promise<ExtractionSettings> {
  const slots = await MODEL_SLOTS_SETTING.load(store.db);
  const mayCreate = await LLM_MAY_CREATE_SETTING.load(store.db);
  // The hub organizes this device's entries, so it calls no model of its own.
  const delegated = (await loadExtractionMode(store)) === 'delegate';
  return {
    models: delegated ? [] : extractionChain(slots),
    llmMayCreate: mayCreate,
    learnFromCorrections: await loadLearnFromCorrections(store),
  };
}
