import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { LlmError, type LocalDate, localDate, weekdayOf } from '@avchetan/shared';
import { type LanguageModelUsage, type ModelMessage, stepCountIs, streamText } from 'ai';
import type { LlmDeps } from '../llm/generate-structured';
import { buildSystem, FINAL_STEP_NOTE } from '../prompts/analysis.v1';
import type { ModelConfig } from '../providers/config';
import { modelTimeoutError, toLlmError } from '../providers/errors';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import {
  factLine,
  isPlainTotalsQuestion,
  periodOf,
  plainAnswer,
  type Totals,
  topicOf,
} from './question-facts';
import {
  createAnalysisTools,
  createCitations,
  normalizeCitations,
  type SearchHistory,
} from './tools';

const MAX_STEPS = 6;
const CLOUD_TIMEOUT_MS = 90_000;
/**
 * Ask may look things up a few times before answering, and on a processor alone each step takes
 * minutes: 3 minutes timed out on a real PC (v0.5.0 test build 3; 6 chosen 2026-11-25).
 */
export const ASK_LOCAL_TIMEOUT_MS = 360_000;
const LOCAL_TIMEOUT_MS = ASK_LOCAL_TIMEOUT_MS;

export type AskSource = { number: number; rawLog: RawLog };
export type AskResult = { answer: string; sources: AskSource[] };

export type AskRequest = {
  question: string;
  model: ModelConfig;
  timeZone: string;
  /** Receives the answer as it arrives. */
  onText: (text: string) => void;
  abortSignal?: AbortSignal;
  /** Search by meaning on the hub; without it Ask searches by words only. */
  searchHistory?: SearchHistory;
};

/**
 * The question's period and number, added up by code with the same totals tool the model has,
 * so its sources are cited the same way. Null when the question names no period or number this
 * understands, or a category this log doesn't have.
 */
async function computedFacts(
  question: string,
  today: LocalDate,
  tools: ReturnType<typeof createAnalysisTools>,
) {
  const period = periodOf(question, today);
  const topic = topicOf(question);
  const execute = tools.aggregate_metrics.execute;
  if (!period || !topic || !execute) return null;
  const input = (agg: 'sum' | 'avg') => ({
    metric: topic.metric,
    agg,
    from: period.from,
    to: period.to,
    ...(topic.category ? { category: topic.category } : {}),
  });
  const totals = async (agg: 'sum' | 'avg') =>
    (await execute(
      input(agg),
      // Called by code, not the model: no call ID or messages of its own.
      { toolCallId: `computed-${agg}`, messages: [], context: {} } as never,
    )) as Totals;
  const sum = await totals('sum');
  // A category the person doesn't use says nothing about the question.
  if (topic.category && sum.rows === 0) return null;
  const all = { sum, average: await totals('avg') };
  return {
    line: factLine(topic, period, all),
    answer: plainAnswer(topic, period, all),
    /** The total as a lookup the model already made: what its rules ask facts to come from. */
    messages: [
      { role: 'user', content: question },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'computed-sum',
            toolName: 'aggregate_metrics',
            input: input('sum'),
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'computed-sum',
            toolName: 'aggregate_metrics',
            output: { type: 'json', value: sum },
          },
        ],
      },
    ] satisfies ModelMessage[],
  };
}

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

  const tools = createAnalysisTools(store, {
    // The privacy line: only a model on this PC may read private entries.
    scope: { includePrivate: adapter.local },
    today,
    citations,
    searchHistory: request.searchHistory,
  });

  const computed = await computedFacts(question, today, tools);
  if (computed && isPlainTotalsQuestion(question)) {
    // The app's own total answers it: no model, so nothing to wait for and nothing to get wrong.
    answer = computed.answer;
  } else {
    await answerWithModel();
  }

  async function answerWithModel() {
    try {
      const result = streamText({
        model: await llm.resolveModel(model),
        system: buildSystem({
          today,
          weekday: weekdayOf(today),
          semanticSearch: request.searchHistory !== undefined,
          computed: computed?.line ?? null,
        }),
        ...(computed ? { messages: computed.messages } : { prompt: question }),
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        // The last step must answer: no tools, and told so.
        prepareStep: ({ stepNumber, messages }) =>
          stepNumber === MAX_STEPS - 1
            ? {
                activeTools: [],
                toolChoice: 'none',
                messages: [...messages, { role: 'user', content: FINAL_STEP_NOTE }],
              }
            : undefined,
        temperature: model.temperature ?? 0,
        maxRetries: 0,
        timeout: model.timeoutMs ?? (adapter.local ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS),
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
        ...(adapter.analysisOptions ? { providerOptions: adapter.analysisOptions } : {}),
      });

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          answer += part.text;
          onText(normalizeCitations(answer));
        } else if (part.type === 'finish') {
          usage = part.totalUsage;
        } else if (part.type === 'error') {
          failure = part.error;
        } else if (part.type === 'abort') {
          // The timeout ends the stream without an error. Nothing in the app cancels an Ask yet.
          failure ??= modelTimeoutError();
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
  }

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
