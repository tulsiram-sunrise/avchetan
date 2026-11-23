import { LlmError, localDate } from '@avchetan/shared';
import { type AskResult, ask } from '../analysis/ask';
import { loadAnalysisMode, loadAnalysisModel } from '../extraction/settings';
import { llmDepsFor } from '../llm/llm-deps';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import type { DeviceDeps } from './device-deps';

/** No model to ask: say so, and give what the device can count by itself. */
async function offlineSummary({ store, timeZone, words }: DeviceDeps): Promise<AskResult> {
  const today = localDate(store.clock.now(), timeZone());
  const activities = await store.queries.activitiesOn(store.db, today);
  const tasks = await store.queries.openTasks(store.db);
  return {
    answer: `You're offline, so I can't ask the AI. From this ${words.device}: ${activities.length} activities today, ${tasks.length} open tasks.`,
    sources: [],
  };
}

/**
 * Answers a question (docs/product/ask.md) with the model this device's settings choose: the
 * hub's when the hub answers (ADR-0022), else this device's answers model. Offline with a cloud
 * model, it answers from local counts and sends nothing.
 */
export async function askQuestion(
  deps: DeviceDeps,
  question: string,
  onText: (text: string) => void,
): Promise<AskResult> {
  const { store, platform, hub, timeZone, words } = deps;
  if ((await loadAnalysisMode(store)) === 'hub') {
    if (!platform.network.isOnline()) return offlineSummary(deps);
    return hub.ask({ question, timeZone: timeZone() }, onText);
  }
  const model = await loadAnalysisModel(store);
  if (!model) throw new LlmError('llm_auth', `Choose a model in ${words.modelsPlace} first`);
  if (!platform.network.isOnline() && !PROVIDER_ADAPTERS[model.provider].local) {
    return offlineSummary(deps);
  }
  // Search by meaning runs on the hub, so it's offered only once one is set up.
  const searchHistory = (await hub.isSetUp()) ? hub.search : undefined;
  return ask(
    store,
    { question, model, timeZone: timeZone(), onText, ...(searchHistory ? { searchHistory } : {}) },
    llmDepsFor(store, platform),
  );
}
