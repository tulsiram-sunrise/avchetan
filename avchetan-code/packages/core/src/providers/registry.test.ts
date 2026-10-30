import { LlmError } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLM_PROVIDERS, type ModelConfig } from './config';
import { apiKeySecretName, createModel, PROVIDER_ADAPTERS } from './registry';

const fakeFetch = vi.fn<typeof fetch>();
let secrets: MemorySecretStore;

beforeEach(() => {
  fakeFetch.mockReset();
  fakeFetch.mockResolvedValue(new Response('{}', { status: 500 }));
  secrets = new MemorySecretStore();
});

/** Sends one request through the real provider client and returns what reached fetch. */
async function requestSentBy(config: ModelConfig) {
  const model = await createModel(config, { fetch: fakeFetch, secrets });
  await expect(generateText({ model, prompt: 'hello', maxRetries: 0 })).rejects.toThrow();
  const [url, init] = fakeFetch.mock.calls[0] ?? [];
  return { url: String(url), headers: new Headers(init?.headers) };
}

describe('PROVIDER_ADAPTERS', () => {
  it.each(LLM_PROVIDERS)('has an adapter registered under its own id: %s', (provider) => {
    expect(PROVIDER_ADAPTERS[provider].id).toBe(provider);
  });

  it('flags Gemini as using free-tier content and Ollama as local', () => {
    expect(PROVIDER_ADAPTERS.google.freeTierUsesContent).toBe(true);
    expect(PROVIDER_ADAPTERS.ollama.local).toBe(true);
    expect(PROVIDER_ADAPTERS.groq.local).toBe(false);
  });
});

describe('createModel', () => {
  it('sends the stored Groq key through the injected fetch', async () => {
    await secrets.set(apiKeySecretName('groq'), 'test-key');
    const { url, headers } = await requestSentBy({ provider: 'groq', model: 'test-model' });
    expect(url).toContain('api.groq.com');
    expect(headers.get('authorization')).toBe('Bearer test-key');
  });

  it('sends the stored Gemini key through the injected fetch', async () => {
    await secrets.set(apiKeySecretName('google'), 'test-key');
    const { url, headers } = await requestSentBy({ provider: 'google', model: 'test-model' });
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(headers.get('x-goog-api-key')).toBe('test-key');
  });

  it.each(LLM_PROVIDERS.filter((provider) => PROVIDER_ADAPTERS[provider].requiresApiKey))(
    'needs a key for %s',
    async (provider) => {
      const failure = createModel({ provider, model: 'test-model' }, { fetch: fakeFetch, secrets });
      await expect(failure).rejects.toBeInstanceOf(LlmError);
      await expect(failure).rejects.toMatchObject({ code: 'llm_auth' });
    },
  );

  it('reaches local Ollama with no key', async () => {
    const { url, headers } = await requestSentBy({ provider: 'ollama', model: 'test-model' });
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers.has('authorization')).toBe(false);
  });

  it('honours a LAN base URL for Ollama', async () => {
    const { url } = await requestSentBy({
      provider: 'ollama',
      model: 'test-model',
      baseUrl: 'http://192.0.2.10:11434/v1',
    });
    expect(url).toBe('http://192.0.2.10:11434/v1/chat/completions');
  });

  it('picks up a changed key on the next call', async () => {
    await secrets.set(apiKeySecretName('groq'), 'old-key');
    await createModel({ provider: 'groq', model: 'test-model' }, { fetch: fakeFetch, secrets });
    await secrets.set(apiKeySecretName('groq'), 'new-key');
    const { headers } = await requestSentBy({ provider: 'groq', model: 'test-model' });
    expect(headers.get('authorization')).toBe('Bearer new-key');
  });
});
