import { type ClientStore, defineSetting, defineSettingGroup } from '@avchetan/db/sqlite';
import { z } from 'zod';

/**
 * Client-local voice settings (docs/product/voice-capture.md#shared). The desktop uses `model`,
 * `language` and `device`; the phone uses `locale`.
 */
export const WHISPER_LANGUAGES = ['auto', 'en', 'hi'] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];

/**
 * Android recognizer languages. `mixed` starts in English (India) and lets the recognizer switch
 * to Hindi (Android 14+): Google's Hindi recognizer writes English words in Devanagari too.
 * `phone` follows the phone's language.
 */
export const SPEECH_LOCALES = ['mixed', 'en-IN', 'hi-IN', 'phone'] as const;
export type SpeechLocale = (typeof SPEECH_LOCALES)[number];

export const voiceSettingsSchema = z.object({
  /** A `speechModels` id from presets.json, or '' for none. */
  model: z.string(),
  language: z.enum(WHISPER_LANGUAGES),
  /** A microphone name, or '' for the Windows default. */
  device: z.string(),
  locale: z.enum(SPEECH_LOCALES),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  model: '',
  language: 'auto',
  device: '',
  locale: 'mixed',
};

const { shape } = voiceSettingsSchema;
const D = DEFAULT_VOICE_SETTINGS;

/** One setting per field, so one bad value doesn't reset the rest. */
export const VOICE_SETTINGS = defineSettingGroup<VoiceSettings>({
  model: defineSetting('voice.model', shape.model, D.model),
  language: defineSetting('voice.language', shape.language, D.language),
  device: defineSetting('voice.device', shape.device, D.device),
  locale: defineSetting('voice.locale', shape.locale, D.locale),
});

export function loadVoiceSettings(store: ClientStore): Promise<VoiceSettings> {
  return VOICE_SETTINGS.load(store.db);
}

export async function saveVoiceSettings(
  store: ClientStore,
  changes: Partial<VoiceSettings>,
): Promise<void> {
  await store.write((tx) => VOICE_SETTINGS.save(tx, changes, store.clock.now()));
}

/**
 * Puts dictated text into a draft at the cursor, with a space on each side where words would
 * otherwise run together. Returns the new draft and where the cursor goes.
 */
export function insertDictation(
  draft: string,
  cursor: number,
  spoken: string,
): { text: string; cursor: number } {
  const words = spoken.trim().replace(/\s+/g, ' ');
  const at = Math.max(0, Math.min(cursor, draft.length));
  if (!words) return { text: draft, cursor: at };
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${words}${trail}`;
  return {
    text: `${before}${inserted}${after}`,
    cursor: before.length + lead.length + words.length,
  };
}
