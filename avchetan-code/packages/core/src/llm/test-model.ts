import { z } from 'zod';
import type { ModelConfig } from '../providers/config';
import { generateStructured, type LlmDeps } from './generate-structured';

const answerSchema = z.object({ title: z.string() });

/**
 * The settings "Test" button: one structured call with made-up text, the same kind of call
 * extraction makes. Throws the usual LLM errors. Not recorded in `llm_runs`: it isn't usage.
 */
export async function testModel(
  config: ModelConfig,
  { resolveModel }: Pick<LlmDeps, 'resolveModel'>,
): Promise<{ latencyMs: number }> {
  let latencyMs = 0;
  await generateStructured(
    {
      purpose: 'extraction',
      models: [config],
      schema: answerSchema,
      system: 'Give the entry a short title as JSON.',
      prompt: 'Went for a walk in the park',
    },
    {
      resolveModel,
      recordRun: async (run) => {
        latencyMs = run.latencyMs;
      },
    },
  );
  return { latencyMs };
}
