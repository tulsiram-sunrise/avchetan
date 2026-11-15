import { type HttpFetch, LlmError } from '@avchetan/shared';
import { z } from 'zod';
import type { ModelConfig } from './config';

const DEFAULT_ROOT = 'http://localhost:11434';

/** Ollama's own API sits beside the OpenAI-compatible `/v1` the models use. */
export function ollamaRoot(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_ROOT).replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** Ollama lists its models at once; no answer by then counts as not running. */
const TAGS_TIMEOUT_MS = 5_000;

const tagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

export type OllamaModels = { running: false } | { running: true; models: string[] };

/** What Ollama has downloaded. `running: false` when nothing answers at its address. */
export async function listOllamaModels(fetch: HttpFetch, baseUrl?: string): Promise<OllamaModels> {
  let response: Response;
  try {
    response = await fetch(`${ollamaRoot(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
  } catch {
    return { running: false };
  }
  if (!response.ok) {
    throw new LlmError('llm_unavailable', 'Ollama answered with an error', {
      details: { status: response.status },
    });
  }
  const { models } = tagsSchema.parse(await response.json());
  return { running: true, models: models.map((model) => model.name) };
}

/**
 * Whether a model in the chain can take an entry now: a cloud model while online, Ollama only when
 * its address answers. A call to an Ollama the device can't reach (a PC at home, the phone out)
 * otherwise waits up to three minutes, and counts as one of the entry's tries.
 */
export async function someModelAnswers(
  fetch: HttpFetch,
  models: readonly ModelConfig[],
  online: boolean,
): Promise<boolean> {
  if (online && models.some((model) => model.provider !== 'ollama')) return true;
  const roots = new Set(
    models.filter((model) => model.provider === 'ollama').map((model) => ollamaRoot(model.baseUrl)),
  );
  for (const root of roots) {
    const answer = await listOllamaModels(fetch, root).catch((error: unknown) => {
      // An error status still means something is there; the real call reports what's wrong.
      if (error instanceof LlmError) return { running: true } as const;
      throw error;
    });
    if (answer.running) return true;
  }
  return false;
}

/** Models in `wanted` that Ollama doesn't have. A name without a tag means `:latest`. */
export function missingOllamaModels(
  installed: readonly string[],
  wanted: readonly string[],
): string[] {
  // Ollama always lists names with their tag.
  const have = new Set(installed);
  return [...new Set(wanted)].filter(
    (name) => !have.has(name.includes(':') ? name : `${name}:latest`),
  );
}

const pullLineSchema = z.object({
  status: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
  error: z.string().optional(),
});

export type PullProgress = { status: string; completed: number | null; total: number | null };

/** Downloads a model, reporting progress as Ollama streams it (one JSON object per line). */
export async function pullOllamaModel(
  fetch: HttpFetch,
  model: string,
  onProgress: (progress: PullProgress) => void,
  baseUrl?: string,
): Promise<void> {
  const failed = (reason: string, details: Record<string, unknown> = {}) =>
    new LlmError('llm_unavailable', `Ollama couldn't download ${model}`, {
      details: { reason, ...details },
    });
  let response: Response;
  try {
    response = await fetch(`${ollamaRoot(baseUrl)}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
  } catch {
    throw failed('not_running');
  }
  if (!response.ok || !response.body) throw failed('http', { status: response.status });

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  let done = false;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const parsed = pullLineSchema.safeParse(JSON.parse(line));
    if (!parsed.success) return;
    const { status, total, completed, error } = parsed.data;
    if (error) throw failed('pull_error');
    if (status === 'success') done = true;
    onProgress({ status: status ?? '', completed: completed ?? null, total: total ?? null });
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += chunk.value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  handle(buffered);
  if (!done) throw failed('incomplete');
}
