import { LlmError } from '@avchetan/shared';
import { APICallError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModelConfig } from '../providers/config';
import { generateStructured, type LlmDeps, type LlmRun } from './generate-structured';

const schema = z.object({ title: z.string() });
const primary: ModelConfig = { provider: 'groq', model: 'primary-model' };
const backup: ModelConfig = { provider: 'ollama', model: 'backup-model' };

type DoGenerate = MockLanguageModelV4['doGenerate'];

function answer(text: string) {
  return {
    content: text ? [{ type: 'text' as const, text }] : [],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 11, noCache: 11, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 7, text: 7, reasoning: undefined },
    },
    warnings: [],
  };
}

function apiError(statusCode: number | undefined, extra: Partial<APICallError> = {}) {
  return new APICallError({
    message: extra.message ?? 'failed',
    url: 'http://test.invalid',
    requestBodyValues: { prompt: 'made-up private text' },
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(extra.responseHeaders ? { responseHeaders: extra.responseHeaders } : {}),
    ...(extra.responseBody ? { responseBody: extra.responseBody } : {}),
  });
}

function setup(models: Record<string, DoGenerate>) {
  const runs: LlmRun[] = [];
  const deps: LlmDeps = {
    resolveModel: async (config): Promise<LanguageModel> => {
      const doGenerate = models[config.model];
      if (!doGenerate) throw new Error(`no mock for ${config.model}`);
      return new MockLanguageModelV4({ modelId: config.model, doGenerate });
    },
    recordRun: async (run) => {
      runs.push(run);
    },
  };
  return { runs, deps };
}

function request(models: readonly ModelConfig[]) {
  return {
    purpose: 'extraction' as const,
    rawLogId: 'log-1',
    models,
    schema,
    system: 'system',
    prompt: 'prompt',
  };
}

describe('generateStructured', () => {
  it('returns the validated object and records usage', async () => {
    const { runs, deps } = setup({
      'primary-model': async () => answer('{"title":"Ran 5k"}'),
    });

    const result = await generateStructured(request([primary]), deps);

    expect(result).toEqual({
      output: { title: 'Ran 5k' },
      provider: 'groq',
      model: 'primary-model',
    });
    expect(runs).toEqual([
      expect.objectContaining({
        rawLogId: 'log-1',
        purpose: 'extraction',
        provider: 'groq',
        model: 'primary-model',
        inputTokens: 11,
        outputTokens: 7,
        ok: true,
        errorCode: null,
      }),
    ]);
  });

  it('repairs an invalid answer once, sending it back to the model', async () => {
    const doGenerate = vi
      .fn<DoGenerate & object>()
      .mockResolvedValueOnce(answer('{"name":"wrong key"}'))
      .mockResolvedValueOnce(answer('{"title":"fixed"}'));
    const { runs, deps } = setup({ 'primary-model': doGenerate });

    const result = await generateStructured(request([primary]), deps);

    expect(result.output).toEqual({ title: 'fixed' });
    expect(runs.map((run) => run.errorCode)).toEqual(['llm_invalid_output', null]);
    const repair = doGenerate.mock.calls[1]?.[0].prompt ?? [];
    expect(repair.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('fails with llm_invalid_output when the repair is invalid too', async () => {
    const doGenerate = vi.fn<DoGenerate>().mockResolvedValue(answer('not json'));
    const { deps } = setup({ 'primary-model': doGenerate, 'backup-model': doGenerate });

    await expect(generateStructured(request([primary, backup]), deps)).rejects.toMatchObject({
      code: 'llm_invalid_output',
    });
    // A validation failure never moves to the fallback model.
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it('treats an empty answer as a refusal, with no repair', async () => {
    const doGenerate = vi.fn<DoGenerate>().mockResolvedValue(answer(''));
    const { deps } = setup({ 'primary-model': doGenerate });

    await expect(generateStructured(request([primary]), deps)).rejects.toMatchObject({
      code: 'llm_refused',
    });
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('falls back on an availability error and records both runs', async () => {
    const { runs, deps } = setup({
      'primary-model': async () => {
        throw apiError(503);
      },
      'backup-model': async () => answer('{"title":"from backup"}'),
    });

    const result = await generateStructured(request([primary, backup]), deps);

    expect(result).toMatchObject({ provider: 'ollama', model: 'backup-model' });
    expect(runs.map((run) => [run.model, run.ok, run.errorCode])).toEqual([
      ['primary-model', false, 'llm_unavailable'],
      ['backup-model', true, null],
    ]);
  });

  it('treats a dropped connection as unavailable', async () => {
    const { deps } = setup({
      'primary-model': async () => {
        throw apiError(undefined);
      },
    });

    await expect(generateStructured(request([primary]), deps)).rejects.toMatchObject({
      code: 'llm_unavailable',
    });
  });

  it('times out using the slot setting', async () => {
    const { deps } = setup({
      'primary-model': ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        }),
    });

    await expect(
      generateStructured(request([{ ...primary, timeoutMs: 5 }]), deps),
    ).rejects.toMatchObject({ code: 'llm_unavailable' });
  });

  it.each([
    [401, 'llm_auth'],
    [403, 'llm_auth'],
    [429, 'llm_rate_limit'],
  ])('stops on a %i without trying the fallback', async (status, code) => {
    const backupCall = vi.fn<DoGenerate>();
    const { deps } = setup({
      'primary-model': async () => {
        throw apiError(status);
      },
      'backup-model': backupCall,
    });

    await expect(generateStructured(request([primary, backup]), deps)).rejects.toMatchObject({
      code,
    });
    expect(backupCall).not.toHaveBeenCalled();
  });

  it("reads Gemini's 400 for a bad key as llm_auth through its adapter", async () => {
    const backupCall = vi.fn<DoGenerate>();
    const { deps } = setup({
      'gemini-model': async () => {
        throw apiError(400, { responseBody: '{"error":{"reason":"API_KEY_INVALID"}}' });
      },
      'backup-model': backupCall,
    });

    await expect(
      generateStructured(request([{ provider: 'google', model: 'gemini-model' }, backup]), deps),
    ).rejects.toMatchObject({ code: 'llm_auth' });
    expect(backupCall).not.toHaveBeenCalled();
  });

  it('reports retry-after in milliseconds', async () => {
    const { deps } = setup({
      'primary-model': async () => {
        throw apiError(429, { responseHeaders: { 'retry-after': '30' } });
      },
    });

    await expect(generateStructured(request([primary]), deps)).rejects.toMatchObject({
      details: { status: 429, retryAfterMs: 30_000 },
    });
  });

  it('recognizes a context overflow', async () => {
    const { deps } = setup({
      'primary-model': async () => {
        throw apiError(400, { message: 'maximum context length exceeded' });
      },
    });

    await expect(generateStructured(request([primary]), deps)).rejects.toMatchObject({
      code: 'llm_context_overflow',
    });
  });

  it('keeps the request body out of the thrown error', async () => {
    const { deps } = setup({
      'primary-model': async () => {
        throw apiError(500);
      },
    });

    const error = await generateStructured(request([primary]), deps).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'llm_unavailable' });
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('made-up private text');
  });

  it('surfaces a missing key from the resolver and records it', async () => {
    const { runs, deps } = setup({});
    deps.resolveModel = async () => {
      throw new LlmError('llm_auth', 'No API key is set for this provider');
    };

    await expect(generateStructured(request([primary]), deps)).rejects.toMatchObject({
      code: 'llm_auth',
    });
    expect(runs[0]).toMatchObject({ ok: false, errorCode: 'llm_auth' });
  });

  it('fails clearly when no model is configured', async () => {
    const { deps } = setup({});
    await expect(generateStructured(request([]), deps)).rejects.toMatchObject({
      code: 'llm_auth',
    });
  });

  it('still returns the result when recording fails', async () => {
    const { deps } = setup({ 'primary-model': async () => answer('{"title":"ok"}') });
    deps.recordRun = async () => {
      throw new Error('disk full');
    };

    await expect(generateStructured(request([primary]), deps)).resolves.toMatchObject({
      output: { title: 'ok' },
    });
  });
});
