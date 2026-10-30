import type { LlmPurpose } from '@avchetan/db';
import { type AppError, createLogger, LlmError, toAppError } from '@avchetan/shared';
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
} from 'ai';
import type { z } from 'zod';
import type { ModelConfig } from '../providers/config';
import { toLlmError } from '../providers/errors';
import { PROVIDER_ADAPTERS } from '../providers/registry';

const log = createLogger('llm');

const DEFAULT_TIMEOUT_MS: Record<LlmPurpose, number> = {
  extraction: 20_000,
  analysis: 90_000,
  embedding: 20_000,
  transcription: 90_000,
};

/** One model call for the audit trail. Never holds prompts or answers. */
export type LlmRun = {
  rawLogId: string | null;
  purpose: LlmPurpose;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  ok: boolean;
  errorCode: string | null;
};

export type LlmDeps = {
  resolveModel(config: ModelConfig): Promise<LanguageModel>;
  /** Clients write `llm_runs`; the server writes a log line. */
  recordRun(run: LlmRun): Promise<void>;
};

export type StructuredRequest<T> = {
  purpose: LlmPurpose;
  rawLogId?: string;
  /** Tried in order: the slot's model, then its fallbacks. */
  models: readonly ModelConfig[];
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
};

export type StructuredResult<T> = {
  output: T;
  provider: string;
  model: string;
};

type Usage = { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;

type CallOutcome<T> =
  | { ok: true; output: T }
  /** `invalidText` is the unusable answer, kept only to send back in the repair retry. */
  | { ok: false; error: AppError; invalidText?: string | undefined };

async function record(deps: LlmDeps, run: LlmRun): Promise<void> {
  try {
    await deps.recordRun(run);
  } catch (error) {
    // The audit trail must never cost the user a finished extraction.
    log.warn('recording llm run failed', { code: toAppError(error).code });
  }
}

async function callModel<T>(
  config: ModelConfig,
  messages: ModelMessage[],
  request: StructuredRequest<T>,
  deps: LlmDeps,
): Promise<CallOutcome<T>> {
  const startedAt = Date.now();
  const finish = (ok: boolean, usage: Usage, errorCode: string | null) =>
    record(deps, {
      rawLogId: request.rawLogId ?? null,
      purpose: request.purpose,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      ok,
      errorCode,
    });

  try {
    const result = await generateText({
      model: await deps.resolveModel(config),
      system: request.system,
      messages,
      output: Output.object({ schema: request.schema }),
      temperature: config.temperature ?? 0,
      // Retries belong to the pending processor, which counts attempts and backs off.
      maxRetries: 0,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS[request.purpose],
    });
    const output = result.output as T;
    await finish(true, result.usage, null);
    return { ok: true, output };
  } catch (thrown) {
    const error = toLlmError(thrown, PROVIDER_ADAPTERS[config.provider]);
    const invalid = NoObjectGeneratedError.isInstance(thrown) ? thrown : undefined;
    await finish(false, invalid?.usage, error.code);
    return { ok: false, error, invalidText: invalid?.text };
  }
}

/** One model: a call, plus a single repair retry if the answer fails validation. */
async function callWithRepair<T>(
  config: ModelConfig,
  request: StructuredRequest<T>,
  deps: LlmDeps,
): Promise<CallOutcome<T>> {
  const messages: ModelMessage[] = [{ role: 'user', content: request.prompt }];
  const first = await callModel(config, messages, request, deps);
  if (first.ok || first.error.code !== 'llm_invalid_output' || !first.invalidText) return first;

  return callModel(
    config,
    [
      ...messages,
      { role: 'assistant', content: first.invalidText },
      {
        role: 'user',
        content:
          'That answer did not match the required JSON schema. Reply again with only corrected JSON.',
      },
    ],
    request,
    deps,
  );
}

/**
 * Generates an object that matches `schema`, recording every call. A provider or availability
 * failure moves on to the next model; every other failure stops, because another model will
 * not fix a bad key and fallbacks must not hide a rate limit from the caller's backoff.
 */
export async function generateStructured<T>(
  request: StructuredRequest<T>,
  deps: LlmDeps,
): Promise<StructuredResult<T>> {
  let lastError: AppError = new LlmError('llm_auth', 'No model is configured');
  for (const config of request.models) {
    const outcome = await callWithRepair(config, request, deps);
    if (outcome.ok) {
      return { output: outcome.output, provider: config.provider, model: config.model };
    }
    lastError = outcome.error;
    if (outcome.error.code !== 'llm_unavailable') break;
  }
  throw lastError;
}
