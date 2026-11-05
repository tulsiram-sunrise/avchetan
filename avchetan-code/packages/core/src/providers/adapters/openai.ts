import { createOpenAI } from '@ai-sdk/openai';
import { LlmError } from '@avchetan/shared';
import type { APICallError } from 'ai';
import type { ProviderAdapter } from '../adapter';

/** The `error.code` of an OpenAI-style error body, if any. */
export function openAiErrorCode(error: APICallError): string | undefined {
  try {
    const body = JSON.parse(error.responseBody ?? '') as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    // Not JSON: a proxy or an HTML error page. The shared mapping handles it.
    return undefined;
  }
}

/**
 * Failures OpenAI-style services report in ways the shared mapping would misread: an account
 * without credit answers 429 like a rate limit, but waiting never fixes it.
 */
export function classifyOpenAiError(error: APICallError): LlmError | undefined {
  const code = openAiErrorCode(error);
  const details = error.statusCode === undefined ? {} : { status: error.statusCode };
  if (code === 'insufficient_quota') {
    return new LlmError('llm_no_credit', 'The provider account has no credit left', { details });
  }
  if (code === 'model_not_found' || (error.statusCode === 404 && code === undefined)) {
    return new LlmError('llm_unavailable', "The provider doesn't offer this model", {
      details: { ...details, reason: 'model_missing' },
    });
  }
  return undefined;
}

export const openAiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  requiresApiKey: true,
  local: false,
  // API content isn't used for training by default (OpenAI's API data policy).
  freeTierUsesContent: false,
  preview: true,
  createModel: ({ model }, { apiKey, fetch }) => createOpenAI({ apiKey, fetch })(model),
  createEmbeddingModel: ({ model }, { apiKey, fetch }) =>
    createOpenAI({ apiKey, fetch }).embeddingModel(model),
  classifyError: classifyOpenAiError,
};
