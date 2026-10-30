import {
  type AskResult,
  ask,
  createModel,
  loadAnalysisModel,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { LlmError, localDate } from '@avchetan/shared';
import type { AppServices } from '../app-services';

const ASK_PREFIX = '?';

export function isQuestion(text: string): boolean {
  return text.trimStart().startsWith(ASK_PREFIX);
}

export function questionText(text: string): string {
  return text.trimStart().slice(ASK_PREFIX.length).trim();
}

/** No cloud model to ask: say so, and give what the device can count by itself. */
async function offlineSummary({ store, timeZone }: AppServices): Promise<AskResult> {
  const today = localDate(store.clock.now(), timeZone.current());
  const activities = await store.queries.activitiesOn(store.db, today);
  const tasks = await store.queries.openTasks(store.db);
  return {
    answer: `You're offline, so I can't ask the AI. From this PC: ${activities.length} activities today, ${tasks.length} open tasks.`,
    sources: [],
  };
}

export async function askQuestion(
  services: AppServices,
  question: string,
  onText: (text: string) => void,
): Promise<AskResult> {
  const { store, platform, timeZone } = services;
  const model = await loadAnalysisModel(store);
  if (!model) throw new LlmError('llm_auth', 'Choose a model in Settings → AI models first');
  if (!platform.network.isOnline() && !PROVIDER_ADAPTERS[model.provider].local) {
    return offlineSummary(services);
  }
  const { fetch, secrets } = platform;
  return ask(
    store,
    { question, model, timeZone: timeZone.current(), onText },
    {
      resolveModel: (config) => createModel(config, { fetch, secrets }),
      recordRun: (run) => store.recordLlmRun(run),
    },
  );
}
