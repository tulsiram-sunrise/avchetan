import { AppError, LlmError } from '@avchetan/shared';
import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai';
import type { ProviderAdapter } from './adapter';

export const LLM_ERROR_CODES = [
  'llm_auth',
  'llm_rate_limit',
  'llm_unavailable',
  'llm_invalid_output',
  'llm_refused',
  'llm_context_overflow',
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

const CONTEXT_OVERFLOW =
  /context.{0,10}(length|window)|maximum context|prompt is too long|too many tokens/i;

function fromApiCall(error: APICallError): LlmError {
  const status = error.statusCode;
  const details = status === undefined ? {} : { status };
  if (status === 401 || status === 403) {
    return new LlmError('llm_auth', 'The provider rejected the API key', { details });
  }
  if (status === 429) {
    const seconds = Number(error.responseHeaders?.['retry-after']);
    return new LlmError('llm_rate_limit', 'The provider is rate limiting requests', {
      details: Number.isFinite(seconds) ? { ...details, retryAfterMs: seconds * 1000 } : details,
    });
  }
  if ((status === 400 || status === 413) && CONTEXT_OVERFLOW.test(error.message)) {
    return new LlmError('llm_context_overflow', 'The request is too long for this model', {
      details,
    });
  }
  return new LlmError('llm_unavailable', 'The model could not be reached', { details });
}

/**
 * Maps whatever a model call threw onto the error taxonomy (docs/architecture/llm-engine.md).
 * The original error is deliberately not kept as `cause`: SDK errors carry the request body,
 * which holds the user's log content, and errors end up in logs.
 */
export function toLlmError(error: unknown, adapter?: ProviderAdapter): AppError {
  if (error instanceof AppError) return error;
  if (RetryError.isInstance(error)) return toLlmError(error.lastError, adapter);
  if (APICallError.isInstance(error)) {
    return adapter?.classifyError?.(error) ?? fromApiCall(error);
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === 'content-filter' || !error.text?.trim()) {
      return new LlmError('llm_refused', 'The model returned no answer');
    }
    return new LlmError('llm_invalid_output', 'The model returned an unusable answer');
  }
  if (NoOutputGeneratedError.isInstance(error)) {
    return new LlmError('llm_refused', 'The model returned no answer');
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new LlmError('llm_unavailable', 'The model took too long to answer');
  }
  return new AppError('internal', 'Unexpected error during a model call', {
    details: { thrown: error instanceof Error ? error.name : typeof error },
  });
}
