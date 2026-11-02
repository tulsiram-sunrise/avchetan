import { ask, type LlmDeps, type ModelConfig, type SearchHistory } from '@avchetan/core';
import type { HubAskRequest, HubAskResult } from '@avchetan/sync/protocol';
import type { ServerDevice } from '../fallback/server-device';

export type HubAsk = (
  request: Required<HubAskRequest>,
  onText: (text: string) => void,
  abortSignal: AbortSignal,
) => Promise<HubAskResult>;

/**
 * Answers on the server's own device (ADR-0022): the apps' Ask, with their tools, over the
 * device's copy of the entries, so the hub needs no second set of tools for Postgres.
 */
export function createHubAsk(deps: {
  device: ServerDevice;
  model: ModelConfig;
  llm: LlmDeps;
  searchHistory?: SearchHistory | undefined;
}): HubAsk {
  return async ({ question, timeZone }, onText, abortSignal) => {
    // A question asked right after a capture should see it.
    await deps.device.engine.syncNow();
    const { answer, sources } = await ask(
      deps.device.store,
      {
        question,
        model: deps.model,
        timeZone,
        onText,
        abortSignal,
        ...(deps.searchHistory ? { searchHistory: deps.searchHistory } : {}),
      },
      deps.llm,
    );
    return {
      answer,
      sources: sources.map(({ number, rawLog }) => ({ number, rawLogId: rawLog.id })),
    };
  };
}
