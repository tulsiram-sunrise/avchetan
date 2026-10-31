import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateStructured, type LlmRun } from '../llm/generate-structured';
import { MODEL_PRESETS } from '../models/presets';
import type { LlmProvider } from './config';
import { apiKeySecretName, createModel } from './registry';

/**
 * Calls real providers with one made-up sentence, to prove keys, model IDs and structured
 * output work end to end. Manual only: `pnpm --filter @avchetan/core test:live`. Never in CI.
 * Keys come from the terminal's environment, so nothing is written to disk.
 */
const entrySchema = z.object({
  title: z.string().describe('Short summary of the entry'),
  dueDate: z.string().nullable().describe('YYYY-MM-DD, or null if there is no deadline'),
  tags: z.array(z.string()).describe('Up to three lowercase tags'),
});

const PROVIDERS: { provider: LlmProvider; ready: boolean; apiKey?: string | undefined }[] = [
  { provider: 'groq', ready: Boolean(process.env.GROQ_API_KEY), apiKey: process.env.GROQ_API_KEY },
  {
    provider: 'google',
    ready: Boolean(process.env.GOOGLE_API_KEY),
    apiKey: process.env.GOOGLE_API_KEY,
  },
  { provider: 'ollama', ready: Boolean(process.env.LLM_CHECK_OLLAMA) },
];

describe.each(PROVIDERS)('live check: $provider', ({ provider, ready, apiKey }) => {
  it.runIf(ready)(
    'returns a valid structured answer',
    async () => {
      const secrets = new MemorySecretStore();
      if (apiKey) await secrets.set(apiKeySecretName(provider), apiKey);
      const model =
        process.env[`LLM_CHECK_${provider.toUpperCase()}_MODEL`] ??
        MODEL_PRESETS.find((preset) => preset.provider === provider)?.extractionModel;
      if (!model) throw new Error(`No preset model for ${provider}`);

      const runs: LlmRun[] = [];
      const { output } = await generateStructured(
        {
          purpose: 'extraction',
          // Generous: a local model may have to load into memory first.
          models: [{ provider, model, timeoutMs: 170_000 }],
          schema: entrySchema,
          system: 'Turn the entry into the requested JSON. Today is 2026-10-30.',
          prompt: 'Book a dentist appointment for Sam by Friday #health',
        },
        {
          resolveModel: (config) => createModel(config, { fetch, secrets }),
          recordRun: async (run) => {
            runs.push(run);
          },
        },
      );

      expect(entrySchema.safeParse(output).success).toBe(true);
      const { latencyMs, inputTokens, outputTokens } = runs.at(-1) as LlmRun;
      process.stdout.write(
        `${provider} ${model}: ${latencyMs} ms, ${inputTokens} in, ${outputTokens} out, ${runs.length} call(s)\n`,
      );
    },
    180_000,
  );
});
