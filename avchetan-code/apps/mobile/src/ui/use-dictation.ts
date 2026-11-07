import { insertDictation, loadVoiceSettings } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { phoneLocale, speechErrorOutcome, speechLanguage, speechSupport } from '../services/speech';
import { useServices } from '../services-context';

const log = createLogger('voice');

export type Dictation = {
  listening: boolean;
  /** An error code (ERROR_HELP) until the next try. */
  error: string | null;
  heardNothing: boolean;
  start(): void;
  /** Stops and keeps what was heard. */
  stop(): void;
  /** Stops and drops what was heard in this recording. */
  cancel(): void;
};

/**
 * Dictation into the capture box (docs/product/voice-capture.md#phone): Android's on-device
 * recognizer, never its online one. Words are written into the text at the cursor as they are
 * heard; `onText` gets the whole new text. Nothing is saved until the user taps Save.
 */
export function useDictation(props: {
  text: () => string;
  cursor: () => number;
  onText: (text: string) => void;
}): Dictation {
  const { store } = useServices();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heardNothing, setHeardNothing] = useState(false);
  /** The text and cursor when this recording started; each result rewrites from there. */
  const base = useRef<{ text: string; cursor: number } | null>(null);
  const heardAny = useRef(false);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    if (base.current && !heardAny.current) setHeardNothing(true);
    base.current = null;
  });
  useSpeechRecognitionEvent('result', (event) => {
    const from = base.current;
    const transcript = event.results[0]?.transcript ?? '';
    if (!from || !transcript.trim()) return;
    heardAny.current = true;
    props.onText(insertDictation(from.text, from.cursor, transcript).text);
    if (event.isFinal) log.info('dictation written down', { chars: transcript.length });
  });
  useSpeechRecognitionEvent('error', (event) => {
    const outcome = speechErrorOutcome(event.error);
    if (outcome.kind === 'error') {
      log.warn('speech recognition failed', { error: event.error });
      setError(outcome.code);
    } else if (outcome.kind === 'heard_nothing') {
      setHeardNothing(true);
    }
  });

  const start = useCallback(() => {
    void (async () => {
      setError(null);
      setHeardNothing(false);
      const support = speechSupport(ExpoSpeechRecognitionModule, Number(Platform.Version));
      if (!support.ok) {
        log.info('voice unavailable on this phone', { reason: support.reason });
        setError(support.code);
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('mic_permission_denied');
        return;
      }
      const settings = await loadVoiceSettings(store);
      base.current = { text: props.text(), cursor: props.cursor() };
      heardAny.current = false;
      ExpoSpeechRecognitionModule.start({
        lang: speechLanguage(settings.locale, phoneLocale()),
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        maxAlternatives: 1,
      });
    })().catch((caught: unknown) => {
      log.warn('voice did not start', { error: String(caught) });
      setError('transcription_failed');
    });
  }, [props, store]);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  const cancel = useCallback(() => {
    const from = base.current;
    ExpoSpeechRecognitionModule.abort();
    if (from) props.onText(from.text);
    base.current = null;
  }, [props]);

  return { listening, error, heardNothing, start, stop, cancel };
}
