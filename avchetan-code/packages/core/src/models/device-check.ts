import type { ClientStore } from '@avchetan/db/sqlite';
import type { CheckRow, ModelCheck, ModelJob } from '@avchetan/shared';
import {
  loadAnalysisMode,
  loadAnalysisModel,
  loadExtractionMode,
  loadExtractionSettings,
} from '../extraction/settings';
import type { ModelConfig } from '../providers/config';
import { checkModels, type ModelCheckDeps } from '../providers/model-check';

/** Who does a job for this device, and whether its own model is usable. */
export type DeviceModelUse =
  | { job: ModelJob; by: 'hub' }
  | { job: ModelJob; by: 'none' }
  | { job: ModelJob; by: 'device'; config: ModelConfig; check: ModelCheck };

/** Organizing and answers on this device, as the Setup check shows them. */
export async function checkDeviceModels(
  store: ClientStore,
  deps: ModelCheckDeps,
): Promise<DeviceModelUse[]> {
  const [extractionMode, analysisMode, extraction, analysis] = await Promise.all([
    loadExtractionMode(store),
    loadAnalysisMode(store),
    loadExtractionSettings(store),
    loadAnalysisModel(store),
  ]);
  const organizing = extractionMode === 'delegate' ? null : (extraction.models[0] ?? null);
  const answers = analysisMode === 'hub' ? null : analysis;
  const chosen = [
    ...(organizing ? [{ job: 'organizing' as const, config: organizing }] : []),
    ...(answers ? [{ job: 'answers' as const, config: answers }] : []),
  ];
  const checks = await checkModels(chosen, deps);
  const use = (job: ModelJob, delegated: boolean): DeviceModelUse => {
    if (delegated) return { job, by: 'hub' };
    const index = chosen.findIndex((c) => c.job === job);
    const [config, check] = [chosen[index]?.config, checks[index]];
    return config && check ? { job, by: 'device', config, check } : { job, by: 'none' };
  };
  return [use('organizing', extractionMode === 'delegate'), use('answers', analysisMode === 'hub')];
}

const JOB_TITLE: Record<ModelJob, string> = {
  organizing: 'Organizing entries',
  answers: 'Answering questions',
  search: 'Searching by meaning',
};

function deviceModelRow(use: DeviceModelUse): CheckRow {
  const id = `device-ai-${use.job}`;
  const job = JOB_TITLE[use.job];
  if (use.by === 'hub') return { id, state: 'ok', title: `${job}: done by your hub` };
  if (use.by === 'none') {
    return {
      id,
      state: 'optional',
      title: `${job}: no AI model chosen`,
      detail:
        use.job === 'organizing'
          ? 'Entries are saved but not organized until you choose one.'
          : 'Ask is off until you choose one.',
      action: 'ai_models',
    };
  }
  const { model, provider, readiness } = use.check;
  switch (readiness) {
    case 'ready':
      return { id, state: 'ok', title: `${job}: ${model}, downloaded in Ollama` };
    case 'configured':
      return {
        id,
        state: 'ok',
        title: `${job}: ${model} (${provider}), key saved`,
        detail: 'Click Test in AI models to try the key.',
      };
    case 'ollama_not_running':
      return {
        id,
        state: 'problem',
        title: `${job}: Ollama isn't running`,
        detail: `Open Ollama on the PC it runs on. ${job} waits until then; nothing is lost.`,
        helpCode: 'ollama_not_running',
      };
    case 'model_missing':
      return {
        id,
        state: 'problem',
        title: `${job}: Ollama hasn't downloaded ${model}`,
        helpCode: 'model_missing',
        action: 'download_model',
      };
    case 'no_api_key':
      return {
        id,
        state: 'problem',
        title: `${job}: no API key for ${provider}`,
        detail: 'Paste the key in AI models.',
        helpCode: 'llm_auth',
        action: 'ai_models',
      };
  }
}

/** The Setup check's rows for this device's own models. */
export function deviceModelRows(uses: readonly DeviceModelUse[]): CheckRow[] {
  return uses.map(deviceModelRow);
}
