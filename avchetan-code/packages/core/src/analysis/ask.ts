import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { LlmError, localDate, weekdayOf } from '@avchetan/shared';
import { type LanguageModelUsage, stepCountIs, streamText } from 'ai';
import type { LlmDeps } from '../llm/generate-structured';
import { buildSystem } from '../prompts/analysis.v1';
import type { ModelConfig } from '../providers/config';
import { toLlmError } from '../providers/errors';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import { createAnalysisTools, createCitations, normalizeCitations } from './tools';

const MAX_STEPS = 6;
const CLOUD_TIMEOUT_MS = 90_000;
const LOCAL_TIMEOUT_MS = 180_000;

export type AskSource = { number: number; rawLog: RawLog };
export type AskResult = { answer: string; sources: AskSource[] };

export type AskRequest = {
  question: string;
  model: ModelConfig;
  timeZone: string;
  /** Receives the answer as it arrives. */
  onText: (text: string) => void;
  abortSignal?: AbortSignal;
};

/** Answers from the local database through read-only tools. Never writes entries. */
export async function ask(
  store: ClientStore,
  request: AskRequest,
  llm: LlmDeps,
): Promise<AskResult> {
  const { question, model, onText } = request;
  const adapter = PROVIDER_ADAPTERS[model.provider];
  const today = localDate(store.clock.now(), request.timeZone);
  const citations = createCitations();
  const startedAt = Date.now();

  let answer = '';
  let usage: LanguageModelUsage | undefined;
  let failure: unknown;
  const finish = (errorCode: string | null) =>
    llm.recordRun({
      rawLogId: null,
      purpose: 'analysis',
      provider: model.provider,
      model: model.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      ok: errorCode === null,
      errorCode,
    });

  try {
    const result = streamText({
      model: await llm.resolveModel(model),
      system: buildSystem({ today, weekday: weekdayOf(today) }),
      prompt: question,
      tools: createAnalysisTools(store, {
        // The privacy line: only a model on this PC may read private entries.
        scope: { includePrivate: adapter.local },
        today,
        citations,
      }),
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: model.temperature ?? 0,
      maxRetries: 0,
      timeout: model.timeoutMs ?? (adapter.local ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS),
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        answer += part.text;
        onText(normalizeCitations(answer));
      } else if (part.type === 'finish') {
        usage = part.totalUsage;
      } else if (part.type === 'error') {
        failure = part.error;
      }
    }
    if (failure) throw failure;
    if (!answer.trim()) throw new LlmError('llm_refused', 'The model returned no answer');
  } catch (thrown) {
    const error = toLlmError(thrown, adapter);
    await finish(error.code);
    throw error;
  }
  await finish(null);

  answer = citations.withoutInvented(normalizeCitations(answer));
  onText(answer);
  const cited = citations.citedIn(answer);
  const logs = await store.queries.logsById(
    store.db,
    cited.map((item) => item.rawLogId),
    { includePrivate: true },
  );
  const byId = new Map(logs.map((log) => [log.id, log]));
  const sources = cited.flatMap(({ number, rawLogId }) => {
    const rawLog = byId.get(rawLogId);
    return rawLog ? [{ number, rawLog }] : [];
  });
  await store.recordAsk({ question, answer, citedIds: sources.map((s) => s.rawLog.id) });
  return { answer, sources };
}
