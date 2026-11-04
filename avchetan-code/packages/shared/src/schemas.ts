import { z } from 'zod';
import { isUtcInstant } from './clock';
import { isValidLocalDate, isValidTimeZone } from './dates';

/** Common Zod schemas used at every boundary (sync payloads, LLM output, settings). */

export const uuidSchema = z.uuid();

export const utcInstantSchema = z
  .string()
  .refine(isUtcInstant, { message: 'Expected UTC instant like 2026-10-26T14:03:11.402Z' });

export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, { message: 'Expected local date like 2026-10-26' });

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, { message: 'Expected an IANA time zone like Asia/Kolkata' });

/**
 * Whether a model can be used, as far as can be told without asking it anything. `configured`
 * is a cloud model whose key is saved; only a test call shows whether the key works.
 */
export const MODEL_READINESS = [
  'ready',
  'configured',
  'ollama_not_running',
  'model_missing',
  'no_api_key',
] as const;
export type ModelReadiness = (typeof MODEL_READINESS)[number];

/** The jobs a model is chosen for. */
export const MODEL_JOBS = ['organizing', 'answers', 'search'] as const;
export type ModelJob = (typeof MODEL_JOBS)[number];

export const modelCheckSchema = z.object({
  job: z.enum(MODEL_JOBS),
  provider: z.string(),
  model: z.string(),
  readiness: z.enum(MODEL_READINESS),
});
export type ModelCheck = z.infer<typeof modelCheckSchema>;
