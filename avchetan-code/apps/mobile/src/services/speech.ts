import type { SpeechLocale } from '@avchetan/core';

/**
 * Voice on the phone (docs/product/voice-capture.md#phone): Android's own recognizer, on the
 * device only. The parts of expo-speech-recognition used here, so the rules can be tested.
 */
export type SpeechRecognizer = {
  supportsOnDeviceRecognition(): boolean;
  isRecognitionAvailable(): boolean;
  getSupportedLocales(options: Record<string, never>): Promise<{
    locales: string[];
    installedLocales: string[];
  }>;
};

/**
 * Android 13 (API 33) is where the library creates an on-device recognizer. Below it,
 * `requiresOnDeviceRecognition` only *prefers* offline and can send audio to Google, which the
 * plan rules out.
 */
export const MIN_ANDROID_API = 33;

export type SpeechSupport =
  | { ok: true }
  | { ok: false; code: 'speech_offline_unavailable'; reason: 'old_android' | 'no_on_device' };

export function speechSupport(recognizer: SpeechRecognizer, androidApi: number): SpeechSupport {
  if (androidApi < MIN_ANDROID_API) {
    return { ok: false, code: 'speech_offline_unavailable', reason: 'old_android' };
  }
  if (!recognizer.supportsOnDeviceRecognition() || !recognizer.isRecognitionAvailable()) {
    return { ok: false, code: 'speech_offline_unavailable', reason: 'no_on_device' };
  }
  return { ok: true };
}

/** The phone's language, as a BCP 47 tag such as `en-IN`. */
export function phoneLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-IN';
  } catch {
    // Hermes always has Intl; this only guards a broken locale setting.
    return 'en-IN';
  }
}

/** Android 14 (API 34) added switching between languages while listening. */
export const LANGUAGE_SWITCH_API = 34;

export type SpeechRequest = {
  /** The language listening starts in. */
  lang: string;
  /** Every language that must be on the phone. */
  languages: string[];
  androidIntentOptions?: {
    EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced';
    EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: string[];
  };
};

/**
 * What to ask the recognizer for. `mixed` starts in English (India) and may switch to Hindi
 * (India) when it hears Hindi; below Android 14 it is English (India) only.
 */
export function speechRequest(
  locale: SpeechLocale,
  phoneLocale: string,
  androidApi: number,
): SpeechRequest {
  if (locale === 'phone') return { lang: phoneLocale, languages: [phoneLocale] };
  if (locale !== 'mixed') return { lang: locale, languages: [locale] };
  if (androidApi < LANGUAGE_SWITCH_API) return { lang: 'en-IN', languages: ['en-IN'] };
  const languages = ['en-IN', 'hi-IN'];
  return {
    lang: 'en-IN',
    languages,
    androidIntentOptions: {
      EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced',
      EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: languages,
    },
  };
}

export type LocaleReadiness = 'installed' | 'downloadable' | 'unknown';

/**
 * Whether the language is ready offline. Some recognizers don't list their languages; then it
 * is `unknown`, and a recording simply tries.
 */
export function localeReadiness(
  locale: string,
  supported: { locales: string[]; installedLocales: string[] },
): LocaleReadiness {
  const same = (other: string) => other.toLowerCase() === locale.toLowerCase();
  if (supported.installedLocales.some(same)) return 'installed';
  if (supported.locales.some(same)) return 'downloadable';
  return 'unknown';
}

/** What the screen does after an error event from the recognizer. */
export type SpeechOutcome =
  | { kind: 'error'; code: string }
  /** Silence: not an error, just a hint. */
  | { kind: 'heard_nothing' }
  /** Stopped by us (Cancel, leaving the screen). */
  | { kind: 'ignore' };

export function speechErrorOutcome(error: string): SpeechOutcome {
  switch (error) {
    case 'aborted':
      return { kind: 'ignore' };
    case 'no-speech':
    case 'speech-timeout':
      return { kind: 'heard_nothing' };
    case 'not-allowed':
      return { kind: 'error', code: 'mic_permission_denied' };
    case 'audio-capture':
      return { kind: 'error', code: 'mic_unavailable' };
    // An on-device recognizer without the language, or no recognizer at all. `network` can't
    // happen on the device; if it does, the language isn't really offline.
    case 'language-not-supported':
    case 'service-not-allowed':
    case 'network':
      return { kind: 'error', code: 'speech_offline_unavailable' };
    default:
      return { kind: 'error', code: 'transcription_failed' };
  }
}
