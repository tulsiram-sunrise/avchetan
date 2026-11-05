import { MemorySecretStore } from '@avchetan/shared/testing';
import { generateText, Output } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModelConfig } from './config';
import { toLlmError } from './errors';
import { apiKeySecretName, createModel, PROVIDER_ADAPTERS } from './registry';

/**
 * OpenAI, Anthropic and OpenAI-compatible services, tested with recorded answers (made-up
 * content) until live keys are available (docs/roadmap.md, v0.2.0). Each test sends a real
 * request through the provider's SDK client to a fake fetch.
 */

const fakeFetch = vi.fn<typeof fetch>();
let secrets: MemorySecretStore;

beforeEach(async () => {
  fakeFetch.mockReset();
  secrets = new MemorySecretStore();
  await secrets.set(apiKeySecretName('openai'), 'test-openai-key');
  await secrets.set(apiKeySecretName('anthropic'), 'test-anthropic-key');
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const OPENAI_RESPONSE = {
  id: 'resp_1',
  object: 'response',
  created_at: 1_793_000_000,
  status: 'completed',
  model: 'test-model',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello there', annotations: [] }],
    },
  ],
  usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
};

const ANTHROPIC_RESPONSE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'test-model',
  content: [{ type: 'text', text: 'Hello there' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 2 },
};

const CHAT_COMPLETION = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1_793_000_000,
  model: 'test-model',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

async function call(config: ModelConfig) {
  const model = await createModel(config, { fetch: fakeFetch, secrets });
  return generateText({ model, prompt: 'hello', maxRetries: 0 });
}

/** The error a failed call becomes, as the pipeline sees it. */
async function failureOf(config: ModelConfig) {
  try {
    await call(config);
  } catch (error) {
    return toLlmError(error, PROVIDER_ADAPTERS[config.provider]);
  }
  throw new Error('the call succeeded');
}

function sent() {
  const [url, init] = fakeFetch.mock.calls[0] ?? [];
  return { url: String(url), headers: new Headers(init?.headers) };
}

const openai: ModelConfig = { provider: 'openai', model: 'test-model' };
const anthropic: ModelConfig = { provider: 'anthropic', model: 'test-model' };
const compatible: ModelConfig = {
  provider: 'openai_compatible',
  model: 'test-model',
  baseUrl: 'https://llm.example.com/v1',
};

describe('OpenAI', () => {
  it('sends the stored key and reads the answer', async () => {
    fakeFetch.mockResolvedValue(json(200, OPENAI_RESPONSE));
    const result = await call(openai);
    expect(result.text).toBe('Hello there');
    expect(sent().url).toBe('https://api.openai.com/v1/responses');
    expect(sent().headers.get('authorization')).toBe('Bearer test-openai-key');
  });

  it('reads a bad key, a rate limit, no credit and an unknown model', async () => {
    const error = (status: number, code: string, headers?: Record<string, string>) =>
      json(status, { error: { message: 'made-up', type: 'x', code } }, headers);

    fakeFetch.mockResolvedValue(error(401, 'invalid_api_key'));
    expect(await failureOf(openai)).toMatchObject({ code: 'llm_auth' });

    fakeFetch.mockResolvedValue(error(429, 'rate_limit_exceeded', { 'retry-after': '20' }));
    expect(await failureOf(openai)).toMatchObject({
      code: 'llm_rate_limit',
      details: { retryAfterMs: 20_000 },
    });

    fakeFetch.mockResolvedValue(error(429, 'insufficient_quota'));
    expect(await failureOf(openai)).toMatchObject({ code: 'llm_no_credit' });

    fakeFetch.mockResolvedValue(error(404, 'model_not_found'));
    expect(await failureOf(openai)).toMatchObject({
      code: 'llm_unavailable',
      details: { reason: 'model_missing' },
    });
  });
});

describe('Anthropic', () => {
  it('sends the stored key and reads the answer', async () => {
    fakeFetch.mockResolvedValue(json(200, ANTHROPIC_RESPONSE));
    const result = await call(anthropic);
    expect(result.text).toBe('Hello there');
    expect(sent().url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent().headers.get('x-api-key')).toBe('test-anthropic-key');
  });

  it('reads a bad key, a rate limit, no credit, an unknown model and overload', async () => {
    const error = (status: number, type: string, message = 'made-up') =>
      json(status, { type: 'error', error: { type, message } });

    fakeFetch.mockResolvedValue(error(401, 'authentication_error'));
    expect(await failureOf(anthropic)).toMatchObject({ code: 'llm_auth' });

    fakeFetch.mockResolvedValue(error(429, 'rate_limit_error'));
    expect(await failureOf(anthropic)).toMatchObject({ code: 'llm_rate_limit' });

    fakeFetch.mockResolvedValue(
      error(400, 'invalid_request_error', 'Your credit balance is too low to access the API.'),
    );
    expect(await failureOf(anthropic)).toMatchObject({ code: 'llm_no_credit' });

    fakeFetch.mockResolvedValue(error(404, 'not_found_error', 'model: test-model'));
    expect(await failureOf(anthropic)).toMatchObject({
      code: 'llm_unavailable',
      details: { reason: 'model_missing' },
    });

    fakeFetch.mockResolvedValue(error(529, 'overloaded_error'));
    expect(await failureOf(anthropic)).toMatchObject({
      code: 'llm_unavailable',
      details: { status: 529 },
    });
  });

  it('has no embedding models', () => {
    expect(PROVIDER_ADAPTERS.anthropic.createEmbeddingModel).toBeUndefined();
  });
});

describe('OpenAI-compatible service', () => {
  it('calls the given address, without a key when none is saved', async () => {
    fakeFetch.mockResolvedValue(json(200, CHAT_COMPLETION));
    const result = await call(compatible);
    expect(result.text).toBe('Hello there');
    expect(sent().url).toBe('https://llm.example.com/v1/chat/completions');
    expect(sent().headers.get('authorization')).toBeNull();
  });

  it('sends a saved key', async () => {
    await secrets.set(apiKeySecretName('openai_compatible'), 'test-compatible-key');
    fakeFetch.mockResolvedValue(json(200, CHAT_COMPLETION));
    await call(compatible);
    expect(sent().headers.get('authorization')).toBe('Bearer test-compatible-key');
  });

  it('needs an address', async () => {
    await expect(
      call({ provider: 'openai_compatible', model: 'test-model' }),
    ).rejects.toMatchObject({ code: 'model_url_required' });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('reads no credit like OpenAI', async () => {
    fakeFetch.mockResolvedValue(json(429, { error: { message: 'x', code: 'insufficient_quota' } }));
    expect(await failureOf(compatible)).toMatchObject({ code: 'llm_no_credit' });
  });
});

describe('new providers', () => {
  it.each(['openai', 'anthropic', 'openai_compatible'] as const)(
    'are labelled Preview until tried with a real key: %s',
    (provider) => {
      expect(PROVIDER_ADAPTERS[provider].preview).toBe(true);
      expect(PROVIDER_ADAPTERS[provider].local).toBe(false);
    },
  );
});

describe('structured answers, as extraction asks for them', () => {
  // A real model name: for names it doesn't know, the Anthropic SDK falls back to a tool call.
  const claude: ModelConfig = { provider: 'anthropic', model: 'claude-haiku-5-5' };
  const schema = z.object({ title: z.string(), minutes: z.number() });
  const answer = '{"title":"Morning run","minutes":30}';

  it.each([
    [
      'openai',
      openai,
      {
        ...OPENAI_RESPONSE,
        output: [
          {
            ...OPENAI_RESPONSE.output[0],
            content: [{ type: 'output_text', text: answer, annotations: [] }],
          },
        ],
      },
    ],
    ['anthropic', claude, { ...ANTHROPIC_RESPONSE, content: [{ type: 'text', text: answer }] }],
    [
      'openai_compatible',
      compatible,
      {
        ...CHAT_COMPLETION,
        choices: [
          { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
        ],
      },
    ],
  ] as const)('%s returns the object and asks for its JSON schema', async (_name, config, body) => {
    fakeFetch.mockResolvedValue(json(200, body));
    const model = await createModel(config, { fetch: fakeFetch, secrets });
    const result = await generateText({
      model,
      prompt: 'ran for 30 minutes',
      maxRetries: 0,
      output: Output.object({ schema }),
    });
    expect(result.output).toEqual({ title: 'Morning run', minutes: 30 });
    const request = String(fakeFetch.mock.calls[0]?.[1]?.body);
    expect(request).toContain('"minutes"');
  });
});
