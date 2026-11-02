import {
  type AskResult,
  ask,
  createModel,
  loadAnalysisMode,
  loadAnalysisModel,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { LlmError, localDate, systemTimeZone } from '@avchetan/shared';
import { askServer, loadServerUrls, searchServer } from '@avchetan/sync';
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

/** The hub answers with its own model (ADR-0022); the cited entries are already on the phone. */
async function askHub(
  { store, platform }: AppServices,
  question: string,
  onText: (text: string) => void,
): Promise<AskResult> {
  const { fetch, secrets } = platform;
  const { answer, sources } = await askServer(
    { store, fetch, secrets },
    { question, timeZone: systemTimeZone() },
    onText,
  );
  const logs = await store.queries.logsById(
    store.db,
    sources.map((source) => source.rawLogId),
    { includePrivate: true },
  );
  const byId = new Map(logs.map((log) => [log.id, log]));
  const found = sources.flatMap(({ number, rawLogId }) => {
    const rawLog = byId.get(rawLogId);
    // Not synced here yet: the number stays in the answer, without a link.
    return rawLog ? [{ number, rawLog }] : [];
  });
  await store.recordAsk({ question, answer, citedIds: found.map((s) => s.rawLog.id) });
  return { answer, sources: found };
}

export async function askQuestion(
  services: AppServices,
  question: string,
  onText: (text: string) => void,
): Promise<AskResult> {
  const { store, platform } = services;
  if ((await loadAnalysisMode(store)) === 'hub') {
    if (!platform.network.isOnline()) return offlineSummary(services);
    return askHub(services, question, onText);
  }
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
