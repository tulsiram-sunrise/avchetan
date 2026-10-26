import { describe, expect, it } from 'vitest';
import { AppError, attempt, LlmError, toAppError } from './errors';

describe('AppError', () => {
  it('keeps a stable code, details and cause', () => {
    const cause = new Error('socket closed');
    const error = new LlmError('llm_unavailable', 'Model not responding', {
      cause,
      details: { provider: 'ollama' },
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('LlmError');
    expect(error.code).toBe('llm_unavailable');
    expect(error.details).toEqual({ provider: 'ollama' });
    expect(error.cause).toBe(cause);
  });
});

describe('toAppError', () => {
  it('passes AppErrors through', () => {
    const error = new AppError('validation', 'bad');
    expect(toAppError(error)).toBe(error);
  });

  it('wraps plain errors and non-errors as internal', () => {
    expect(toAppError(new Error('boom')).code).toBe('internal');
    const wrapped = toAppError('a string');
    expect(wrapped.code).toBe('internal');
    expect(wrapped.details).toEqual({ thrown: 'string' });
  });
});

describe('attempt', () => {
  it('returns ok for success and err for failure', async () => {
    expect(await attempt(async () => 42)).toEqual({ ok: true, value: 42 });
    const failed = await attempt(async () => {
      throw new AppError('db_locked', 'Database is locked');
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('db_locked');
  });
});
