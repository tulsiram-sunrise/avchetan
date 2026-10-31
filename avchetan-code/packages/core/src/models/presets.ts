import { z } from 'zod';
import { LLM_PROVIDERS } from '../providers/config';
import data from './presets.json';

export const modelPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS),
  extractionModel: z.string().min(1).optional(),
  analysisModel: z.string().min(1).optional(),
});
export type ModelPreset = z.infer<typeof modelPresetSchema>;

/** Suggested models for the settings UI. Edit `presets.json`, never the source. */
export const MODEL_PRESETS: readonly ModelPreset[] = z
  .object({ presets: z.array(modelPresetSchema) })
  .parse(data).presets;
