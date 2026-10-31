import { seedCategoryId } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { addDays, localDate } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import type { LlmRun } from '../llm/generate-structured';
import { MODEL_PRESETS } from '../models/presets';
import type { LlmProvider, ModelConfig } from '../providers/config';
import { apiKeySecretName, createModel } from '../providers/registry';
import { ask } from './ask';

/**
 * Asks real questions about made-up entries, to judge answers by eye.
 * Manual only: `pnpm --filter @avchetan/core test:live ask`.
 */
const QUESTIONS = [
  'how many workouts did I do this week?',
  'how far did I run in total this month?',
  'what tasks are overdue?',
  'when did my knee hurt?',
  'what is my workout streak?',
  'how many pushups did I do last year?',
];

const PAUSE_MS = 15_000;
const provider: LlmProvider = process.env.LLM_CHECK_OLLAMA ? 'ollama' : 'groq';
const apiKey = process.env.GROQ_API_KEY;

describe('live ask', () => {
  it.runIf(provider === 'ollama' || apiKey)(
    'answers questions from tools',
    async () => {
      const { store } = await openTestStore({ start: '2026-10-30T10:00:00.000Z' });
      const today = localDate(store.clock.now(), 'UTC');
      const entries = [
        { text: 'ran 5k', title: 'Morning run', days: 1, metrics: { distance_km: 5 } },
        { text: 'gym, legs', title: 'Leg day', days: 2, metrics: {} },
        { text: 'ran 7k, knee hurt', title: 'Evening run', days: 3, metrics: { distance_km: 7 } },
        { text: 'ran 3k', title: 'Short run', days: 40, metrics: { distance_km: 3 } },
      ];
      for (const { text, title, days, metrics } of entries) {
        const log = await store.write((tx) =>
          store.repos.rawLogs.capture(tx, {
            content: text,
            source: 'desktop_text',
            capturedTz: 'UTC',
          }),
        );
        await store.write((tx) =>
          store.repos.activities.create(tx, {
            categoryId: seedCategoryId('workout'),
            title,
            loggedDate: addDays(today, -days),
            metrics,
            rawLogId: log.id,
          }),
        );
      }
      await store.write((tx) =>
        store.repos.tasks.create(tx, { title: 'Renew gym pass', dueDate: addDays(today, -2) }),
      );

      const secrets = new MemorySecretStore();
      if (apiKey) await secrets.set(apiKeySecretName('groq'), apiKey);
      const model =
        process.env[`LLM_CHECK_${provider.toUpperCase()}_MODEL`] ??
        MODEL_PRESETS.find((preset) => preset.provider === provider)?.analysisModel;
      const config: ModelConfig = { provider, model: model as string, timeoutMs: 170_000 };
      const runs: LlmRun[] = [];
      const llm = {
        resolveModel: (slot: ModelConfig) => createModel(slot, { fetch, secrets }),
        recordRun: async (run: LlmRun) => {
          runs.push(run);
        },
      };

      for (const question of QUESTIONS) {
        const { answer, sources } = await ask(
          store,
          { question, model: config, timeZone: 'UTC', onText: () => {} },
          llm,
        );
        expect(answer.length).toBeGreaterThan(0);
        const run = runs.at(-1) as LlmRun;
        process.stdout.write(
          `\n? ${question}\n${answer}\nsources: ${sources.map((s) => s.number)} | ${run.latencyMs} ms, ${run.inputTokens} in, ${run.outputTokens} out\n`,
        );
        if (provider === 'groq') await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
    },
    580_000,
  );
});
