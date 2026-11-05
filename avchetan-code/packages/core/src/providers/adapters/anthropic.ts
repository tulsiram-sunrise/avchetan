import { createAnthropic } from '@ai-sdk/anthropic';
import { LlmError } from '@avchetan/shared';
import type { APICallError } from 'ai';
import type { ProviderAdapter } from '../adapter';

type AnthropicErrorBody = { error?: { type?: unknown; message?: unknown } };

function errorBody(error: APICallError): { type?: string; message?: string } {
  try {
    const body = JSON.parse(error.responseBody ?? '') as AnthropicErrorBody;
    return {
      ...(typeof body.error?.type === 'string' ? { type: body.error.type } : {}),
      ...(typeof body.error?.message === 'string' ? { message: body.error.message } : {}),
    };
  } catch {
    // Not JSON: the shared mapping handles it by status.
    return {};
  }
}

/**
 * Anthropic answers an empty balance with 400 `invalid_request_error` ("credit balance is too
 * low"), an unknown model with 404 `not_found_error`, and overload with 529.
 */
export function classifyAnthropicError(error: APICallError): LlmError | undefined {
  const { type, message } = errorBody(error);
  const details = error.statusCode === undefined ? {} : { status: error.statusCode };
  if (type === 'invalid_request_error' && message && /credit balance/i.test(message)) {
    return new LlmError('llm_no_credit', 'The provider account has no credit left', { details });
  }
  if (type === 'not_found_error') {
    return new LlmError('llm_unavailable', "The provider doesn't offer this model", {
      details: { ...details, reason: 'model_missing' },
    });
  }
  if (type === 'overloaded_error' || error.statusCode === 529) {
    return new LlmError('llm_unavailable', 'The provider is overloaded right now', { details });
  }
  return undefined;
}

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  requiresApiKey: true,
  local: false,
  // API content isn't used for training by default (Anthropic's commercial terms).
  freeTierUsesContent: false,
  preview: true,
  createModel: ({ model }, { apiKey, fetch }) => createAnthropic({ apiKey, fetch })(model),
  classifyError: classifyAnthropicError,
};
