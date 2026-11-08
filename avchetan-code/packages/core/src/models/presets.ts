import { z } from 'zod';
import { LLM_PROVIDERS } from '../providers/config';
import data from './presets.json';

export const modelPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS),
  extractionModel: z.string().min(1).optional(),
  analysisModel: z.string().min(1).optional(),
  /** For search by meaning, run by the hub. */
  embeddingModel: z.string().min(1).optional(),
});
export type ModelPreset = z.infer<typeof modelPresetSchema>;

/** A Whisper model the desktop app can download for voice capture (docs/product/voice-capture.md). */
export const speechModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  /** The file name in the app's `models/whisper/` folder. */
  file: z.string().regex(/^[A-Za-z0-9._-]+\.bin$/),
  url: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
});
export type SpeechModel = z.infer<typeof speechModelSchema>;

const presetsFile = z
  .object({ presets: z.array(modelPresetSchema), speechModels: z.array(speechModelSchema) })
  .parse(data);

/** Suggested models for the settings UI. Edit `presets.json`, never the source. */
export const MODEL_PRESETS: readonly ModelPreset[] = presetsFile.presets;

/** Speech models offered in Settings → Voice. Edit `presets.json`, never the source. */
export const SPEECH_MODELS: readonly SpeechModel[] = presetsFile.speechModels;

export function findSpeechModel(id: string): SpeechModel | undefined {
  return SPEECH_MODELS.find((model) => model.id === id);
}
