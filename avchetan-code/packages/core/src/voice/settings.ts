import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
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

export const VOICE_SETTING_KEYS = {
  model: 'voice.model',
  language: 'voice.language',
  device: 'voice.device',
  locale: 'voice.locale',
} as const satisfies Record<keyof VoiceSettings, string>;

export async function loadVoiceSettings(store: ClientStore): Promise<VoiceSettings> {
  const keys = Object.keys(VOICE_SETTING_KEYS) as (keyof VoiceSettings)[];
  const values = await Promise.all(
    keys.map((key) => getSetting(store.db, VOICE_SETTING_KEYS[key])),
  );
  const settings = { ...DEFAULT_VOICE_SETTINGS };
  keys.forEach((key, index) => {
    const parsed = voiceSettingsSchema.shape[key].safeParse(values[index]);
    // Each field falls back on its own, so one bad value doesn't reset the rest.
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  });
  return settings;
}

export async function saveVoiceSettings(
  store: ClientStore,
  changes: Partial<VoiceSettings>,
): Promise<void> {
  await store.write(async (tx) => {
    const now = store.clock.now();
    for (const [key, value] of Object.entries(changes) as [keyof VoiceSettings, unknown][]) {
      await setSetting(
        tx,
        VOICE_SETTING_KEYS[key],
        voiceSettingsSchema.shape[key].parse(value),
        now,
      );
    }
  });
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
