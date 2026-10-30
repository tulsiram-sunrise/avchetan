import { z } from 'zod';

export const LLM_PROVIDERS = ['google', 'groq', 'ollama'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** One concrete model. Non-secret: stored in `settings`; keys live in the SecretStore. */
export const modelConfigSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().min(1),
  baseUrl: z.url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const modelSlotsSchema = z.object({
  extraction: modelConfigSchema.optional(),
  analysis: modelConfigSchema.optional(),
  fallbacks: z.object({ extraction: z.array(modelConfigSchema).default([]) }).default({
    extraction: [],
  }),
});
export type ModelSlots = z.infer<typeof modelSlotsSchema>;

/** Models to try for extraction, in order; empty when no extraction slot is configured. */
export function extractionChain(slots: ModelSlots): ModelConfig[] {
  return slots.extraction ? [slots.extraction, ...slots.fallbacks.extraction] : [];
}
