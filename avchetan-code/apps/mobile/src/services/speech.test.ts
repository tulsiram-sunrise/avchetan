import { describe, expect, it } from 'vitest';
import {
  localeReadiness,
  type SpeechRecognizer,
  speechErrorOutcome,
  speechLanguage,
  speechSupport,
} from './speech';

function recognizer(onDevice: boolean, available = true): SpeechRecognizer {
  return {
    supportsOnDeviceRecognition: () => onDevice,
    isRecognitionAvailable: () => available,
    getSupportedLocales: async () => ({ locales: [], installedLocales: [] }),
  };
}

describe('speechSupport', () => {
  it('needs Android 13, where recognition really stays on the phone', () => {
    expect(speechSupport(recognizer(true), 32)).toEqual({
      ok: false,
      code: 'speech_offline_unavailable',
      reason: 'old_android',
    });
    expect(speechSupport(recognizer(true), 33)).toEqual({ ok: true });
  });

  it('refuses a phone without on-device recognition instead of using Google online', () => {
    expect(speechSupport(recognizer(false), 35)).toMatchObject({
      ok: false,
      reason: 'no_on_device',
    });
    expect(speechSupport(recognizer(true, false), 35)).toMatchObject({ ok: false });
  });
});

describe('speechLanguage', () => {
  it('uses the chosen language, or the phone own for "phone"', () => {
    expect(speechLanguage('hi-IN', 'en-GB')).toBe('hi-IN');
    expect(speechLanguage('phone', 'en-GB')).toBe('en-GB');
  });
});

describe('localeReadiness', () => {
  const supported = { locales: ['en-IN', 'hi-IN', 'en-US'], installedLocales: ['en-US'] };
  it('tells installed, downloadable and unknown apart, ignoring case', () => {
    expect(localeReadiness('en-us', supported)).toBe('installed');
    expect(localeReadiness('hi-IN', supported)).toBe('downloadable');
    expect(localeReadiness('ta-IN', supported)).toBe('unknown');
  });
});

describe('speechErrorOutcome', () => {
  it('maps recognizer errors to help codes', () => {
    expect(speechErrorOutcome('not-allowed')).toEqual({
      kind: 'error',
      code: 'mic_permission_denied',
    });
    expect(speechErrorOutcome('audio-capture')).toEqual({ kind: 'error', code: 'mic_unavailable' });
    expect(speechErrorOutcome('language-not-supported')).toEqual({
      kind: 'error',
      code: 'speech_offline_unavailable',
    });
    expect(speechErrorOutcome('busy')).toEqual({ kind: 'error', code: 'transcription_failed' });
  });

  it('treats silence as a hint and our own stop as nothing', () => {
    expect(speechErrorOutcome('no-speech')).toEqual({ kind: 'heard_nothing' });
    expect(speechErrorOutcome('aborted')).toEqual({ kind: 'ignore' });
  });
});
