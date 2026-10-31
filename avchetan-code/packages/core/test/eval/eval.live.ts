import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { extractionRequest } from '../../src/extraction/extract';
import { normalizeExtraction } from '../../src/extraction/normalize';
import type { ExtractionResult } from '../../src/extraction/schema';
import { generateStructured, type LlmRun } from '../../src/llm/generate-structured';
import { MODEL_PRESETS } from '../../src/models/presets';
import { type LlmProvider, modelConfigSchema } from '../../src/providers/config';
import { apiKeySecretName, createModel } from '../../src/providers/registry';
import { captureFixture, openEvalContext } from './context';
import { FIXTURES } from './fixtures';
import { matchFixture } from './match';

/**
 * Runs every fixture against a real model and prints the accuracy. Manual only, never in CI:
 *
 *   $env:GROQ_API_KEY = '...'; pnpm eval:extraction
 *
 * Choose with LLM_EVAL_PROVIDER (groq, google, ollama) and LLM_EVAL_MODEL. LLM_EVAL_RECORD=1 saves
 * the answers that passed for the CI replay test. LLM_EVAL_ONLY limits it to IDs containing a word, LLM_EVAL_VERBOSE shows the metrics of a miss.
 */
const provider = (process.env.LLM_EVAL_PROVIDER ?? 'groq') as LlmProvider;
const KEYS: Partial<Record<LlmProvider, string | undefined>> = {
  groq: process.env.GROQ_API_KEY,
  google: process.env.GOOGLE_API_KEY,
};
const needsKey = provider !== 'ollama';
const apiKey = KEYS[provider];
const PAUSES_MS: Partial<Record<LlmProvider, number>> = { groq: 20_000, google: 7_000 };
const MAX_RATE_LIMIT_WAITS = 5;
const RATE_LIMIT_WAIT_MS = 65_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const here = dirname(fileURLToPath(import.meta.url));

describe('extraction eval', () => {
  it.runIf(!needsKey || apiKey)(
    'scores a real model on the fixtures',
    async () => {
      const secrets = new MemorySecretStore();
      if (apiKey) await secrets.set(apiKeySecretName(provider), apiKey);
      const config = modelConfigSchema.parse({
        provider,
        model:
          process.env.LLM_EVAL_MODEL ??
          MODEL_PRESETS.find((preset) => preset.provider === provider)?.extractionModel,
      });

      const context = await openEvalContext();
      const runs: LlmRun[] = [];
      const llm = {
        resolveModel: () => createModel(config, { fetch, secrets }),
        recordRun: async (run: LlmRun) => {
          runs.push(run);
        },
      };
      const only = process.env.LLM_EVAL_ONLY;
      const fixtures = FIXTURES.filter((fixture) => !only || fixture.id.includes(only));

      const passed: Record<string, ExtractionResult> = {};
      const failures: string[] = [];
      for (const fixture of fixtures) {
        const rawLog = await captureFixture(context.store, fixture);
        const request = extractionRequest(rawLog, [config], context.vocabulary);
        let misses: string[];
        for (let wait = 0; ; wait += 1) {
          try {
            const { output } = await generateStructured(request, llm);
            const plan = normalizeExtraction(output, {
              rawLog,
              vocabulary: context.vocabulary,
              llmMayCreate: 'auto',
              model: 'eval',
              version: 1,
            });
            misses = matchFixture(plan, fixture, context.match);
            if (misses.length > 0 && process.env.LLM_EVAL_VERBOSE) {
              misses.push(JSON.stringify(output.activities.map((item) => item.metrics)));
            }
            if (misses.length === 0) passed[fixture.id] = output;
            break;
          } catch (error) {
            const code = (error as { code?: string }).code ?? 'unknown';
            if (code === 'llm_rate_limit' && wait < MAX_RATE_LIMIT_WAITS) {
              await sleep(RATE_LIMIT_WAIT_MS);
              continue;
            }
            misses = [`failed: ${code}`];
            break;
          }
        }
        if (misses.length > 0) failures.push(fixture.id);
        process.stdout.write(
          `${misses.length === 0 ? 'ok  ' : 'MISS'} ${fixture.id}${misses.length ? `: ${misses.join('; ')}` : ''}\n`,
        );
        await sleep(PAUSES_MS[provider] ?? 0);
      }

      const good = runs.filter((run) => run.ok);
      const average = (pick: (run: LlmRun) => number | null) =>
        Math.round(good.reduce((sum, run) => sum + (pick(run) ?? 0), 0) / (good.length || 1));
      const score = (fixtures.length - failures.length) / (fixtures.length || 1);
      process.stdout.write(
        `\n${provider} ${config.model}: ${fixtures.length - failures.length}/${fixtures.length} = ${(score * 100).toFixed(1)}%\n` +
          `avg ${average((run) => run.latencyMs)} ms, ${average((run) => run.inputTokens)} in, ${average((run) => run.outputTokens)} out, ${runs.length} calls\n`,
      );

      if (process.env.LLM_EVAL_RECORD) {
        const file = join(here, '../fixtures/extraction/recorded.json');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(passed, null, 1)}\n`);
      }
      expect(fixtures.length).toBeGreaterThan(0);
    },
    3_500_000,
  );
});
