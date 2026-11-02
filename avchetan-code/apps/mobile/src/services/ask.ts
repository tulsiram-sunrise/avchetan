import {
  type AskResult,
  ask,
  createModel,
  loadAnalysisModel,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { LlmError, localDate, systemTimeZone } from '@avchetan/shared';
import { loadServerUrls, searchServer } from '@avchetan/sync';
import { MAX_SEARCH_RESULTS } from '@avchetan/sync/protocol';
import type { AppServices } from '../app-services';

/** No cloud model to ask: say so, and give what the phone can count by itself. */
async function offlineSummary({ store }: AppServices): Promise<AskResult> {
  const today = localDate(store.clock.now(), systemTimeZone());
  const activities = await store.queries.activitiesOn(store.db, today);
  const tasks = await store.queries.openTasks(store.db);
  return {
    answer: `You're offline, so I can't ask the AI. From this phone: ${activities.length} activities today, ${tasks.length} open tasks.`,
    sources: [],
  };
}

export async function askQuestion(
  services: AppServices,
  question: string,
  onText: (text: string) => void,
): Promise<AskResult> {
  const { store, platform } = services;
  const model = await loadAnalysisModel(store);
  if (!model) throw new LlmError('llm_auth', 'Choose a model in More → AI models first');
  if (!platform.network.isOnline() && !PROVIDER_ADAPTERS[model.provider].local) {
    return offlineSummary(services);
  }
  const { fetch, secrets } = platform;
  // Search by meaning runs on the hub, so it's offered only once one is set up.
  const searchHistory =
    (await loadServerUrls(store)).length > 0
      ? ({ query }: { query: string }) =>
          searchServer({ store, fetch, secrets }, { query, limit: MAX_SEARCH_RESULTS })
      : undefined;
  return ask(
    store,
    {
      question,
      model,
      timeZone: systemTimeZone(),
      onText,
      ...(searchHistory ? { searchHistory } : {}),
    },
    {
      resolveModel: (config) => createModel(config, { fetch, secrets }),
      recordRun: (run) => store.recordLlmRun(run),
    },
  );
}
