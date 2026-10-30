import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import type { LlmRun } from '../llm/generate-structured';
import { MODEL_PRESETS } from '../models/presets';
import type { LlmProvider, ModelConfig } from '../providers/config';
import { apiKeySecretName, createModel } from '../providers/registry';
import { processRawLog } from './extract';
import { loadVocabulary } from './input';

/**
 * Sends made-up entries through the full pipeline on a real model and prints what came out,
 * to judge the prompt by eye. Manual only: `pnpm --filter @avchetan/core test:live`.
 */
const ENTRIES = [
  'ran 6k in 34 minutes this morning, left knee hurt a bit near the end',
  'lunch with Meera at Green Bowl, paneer wrap. need to send her the report by Tuesday',
  'yesterday slept only 5 hours, low energy all day #health',
  'kal gym gaya, bench 70kg 3x8 aur squat 90kg 4x6',
  'tried pottery class for 2 hours, really enjoyed it',
  'call the plumber tomorrow and pay the electricity bill by next Friday',
  'asdf',
];

const PAUSE_MS = 20_000;
const provider: LlmProvider = process.env.LLM_CHECK_OLLAMA ? 'ollama' : 'groq';
const apiKey = process.env.GROQ_API_KEY;

describe('live extraction', () => {
  it.runIf(provider === 'ollama' || apiKey)(
    'runs the pipeline on made-up entries',
    async () => {
      const secrets = new MemorySecretStore();
      if (apiKey) await secrets.set(apiKeySecretName('groq'), apiKey);
      const model =
        process.env[`LLM_CHECK_${provider.toUpperCase()}_MODEL`] ??
        MODEL_PRESETS.find((preset) => preset.provider === provider)?.extractionModel;
      // Generous: a local model may have to load into memory first.
      const config: ModelConfig = { provider, model: model as string, timeoutMs: 170_000 };

      const { store } = await openTestStore();
      const runs: LlmRun[] = [];
      const llm = {
        resolveModel: (slot: ModelConfig) => createModel(slot, { fetch, secrets }),
        recordRun: async (run: LlmRun) => {
          runs.push(run);
        },
      };

      for (const content of ENTRIES) {
        const log = await store.write((tx) =>
          store.repos.rawLogs.capture(tx, {
            content,
            source: 'desktop_text',
            capturedTz: 'Asia/Kolkata',
          }),
        );
        await processRawLog(
          store,
          log,
          { models: [config], vocabulary: await loadVocabulary(store), llmMayCreate: 'auto' },
          llm,
        );
        const detail = await store.queries.rawLogDetail(store.db, log.id);
        expect(detail?.rawLog.status).toMatch(/processed|skipped/);
        const run = runs.at(-1) as LlmRun;
        process.stdout.write(
          `\n> ${content}\n${run.latencyMs} ms, ${run.inputTokens} in, ${run.outputTokens} out\n${JSON.stringify(
            {
              status: detail?.rawLog.status,
              activities: detail?.activities.map((a) => [a.title, a.loggedDate, a.metrics]),
              tasks: detail?.tasks.map((t) => [t.title, t.dueDate]),
            },
          )}\n`,
        );
        // Stays under the free tier's tokens-per-minute limit.
        if (provider === 'groq') await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
      const total = runs.reduce(
        (sum, run) => sum + (run.inputTokens ?? 0) + (run.outputTokens ?? 0),
        0,
      );
      const newCategories = (await store.repos.categories.listActive(store.db))
        .filter((category) => category.origin === 'llm')
        .map((category) => category.name);
      process.stdout.write(
        `\ntags: ${await store.repos.tags.listRecentPaths(store.db, 30)}\nnames: ${await store.repos.entities.listRecentNames(store.db, 30)}\nnew categories: ${newCategories}\n${runs.length} calls, ${total} tokens\n`,
      );
    },
    580_000,
  );
});
