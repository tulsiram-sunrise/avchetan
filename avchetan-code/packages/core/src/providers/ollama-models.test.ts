import { describe, expect, it, vi } from 'vitest';
import {
  listOllamaModels,
  missingOllamaModels,
  ollamaRoot,
  type PullProgress,
  pullOllamaModel,
} from './ollama-models';

/** A response whose body arrives in the given pieces, as a stream would. */
function streamed(pieces: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, init);
}

describe('ollamaRoot', () => {
  it('drops the /v1 the models use', () => {
    expect(ollamaRoot()).toBe('http://localhost:11434');
    expect(ollamaRoot('http://100.64.0.1:11434/v1/')).toBe('http://100.64.0.1:11434');
  });
});

describe('listOllamaModels', () => {
  it('lists the downloaded models', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ models: [{ name: 'small-model:3b', size: 1 }, { name: 'embed:latest' }] }),
    );
    expect(await listOllamaModels(fetch)).toEqual({
      running: true,
      models: ['small-model:3b', 'embed:latest'],
    });
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', {
      signal: expect.any(AbortSignal),
    });
  });

  it('says Ollama is not running when nothing answers', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    expect(await listOllamaModels(fetch)).toEqual({ running: false });
  });
});

describe('missingOllamaModels', () => {
  it('treats a name without a tag as :latest', () => {
    expect(
      missingOllamaModels(
        ['small-model:3b', 'embed:latest'],
        ['small-model:3b', 'embed', 'big:8b'],
      ),
    ).toEqual(['big:8b']);
  });
});

describe('pullOllamaModel', () => {
  it('reports progress across lines split between chunks, and finishes on success', async () => {
    const fetch = vi.fn(async () =>
      streamed([
        '{"status":"pulling manifest"}\n{"status":"pulling abc","total":100,',
        '"completed":40}\n{"status":"pulling abc","total":100,"completed":100}\n',
        '{"status":"success"}',
      ]),
    );
    const progress: PullProgress[] = [];

    await pullOllamaModel(fetch, 'small-model:3b', (p) => progress.push(p));

    expect(progress.map((p) => p.completed)).toEqual([null, 40, 100, null]);
    expect(progress.at(-1)?.status).toBe('success');
  });

  it('fails with the reason when Ollama reports an error or stops early', async () => {
    await expect(
      pullOllamaModel(
        vi.fn(async () => streamed(['{"error":"pull model manifest: file does not exist"}\n'])),
        'no-such-model',
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'llm_unavailable', details: { reason: 'pull_error' } });
    await expect(
      pullOllamaModel(
        vi.fn(async () => streamed(['{"status":"pulling abc","total":100,"completed":10}\n'])),
        'small-model:3b',
        () => {},
      ),
    ).rejects.toMatchObject({ details: { reason: 'incomplete' } });
  });
});
