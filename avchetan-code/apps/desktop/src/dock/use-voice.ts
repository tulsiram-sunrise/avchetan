import { findSpeechModel, insertDictation, loadVoiceSettings } from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '../native/voice';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';

const log = createLogger('voice');

export type VoiceUi = {
  phase: VoicePhase | 'starting';
  /** 0–1 while listening. */
  level: number;
  /** Seconds since listening started. */
  elapsed: number;
  /** An error code (ERROR_HELP), shown with its Help link until the next try. */
  error: string | null;
  /** Nothing was heard in the last recording. */
  heardNothing: boolean;
  /** Starts, or stops and writes it down (the mic button). */
  toggle(): void;
  /** Stops and throws the recording away (Esc). */
  cancel(): void;
};

/**
 * The dock's voice capture (docs/product/voice-capture.md): the mic button, and holding the
 * dock shortcut. The text goes into the draft at the cursor; nothing is saved until the user
 * saves as usual.
 */
export function useVoice(inputRef: RefObject<HTMLTextAreaElement | null>): VoiceUi {
  const { store, platform } = useServices();
  const [phase, setPhase] = useState<VoiceUi['phase']>('idle');
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [heardNothing, setHeardNothing] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** Where the cursor was when recording started; the text goes there. */
  const cursorRef = useRef<number | null>(null);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    setError(null);
    setHeardNothing(false);
    setPhase('starting');
    cursorRef.current = inputRef.current?.selectionStart ?? null;
    try {
      const settings = await loadVoiceSettings(store);
      const model = findSpeechModel(settings.model);
      if (!model) {
        setError('speech_model_missing');
        setPhase('idle');
        return;
      }
      await platform.voice.start({
        file: model.file,
        language: settings.language,
        device: settings.device,
      });
      // 'listening' arrives as an event; it may already have.
    } catch (caught) {
      const { code } = toAppError(caught);
      log.warn('voice did not start', { code });
      setError(code);
      setPhase('idle');
    }
  }, [inputRef, platform, store]);

  const stop = useCallback(() => {
    platform.voice.stop().catch((caught) => setError(toAppError(caught).code));
  }, [platform]);

  const cancel = useCallback(() => {
    platform.voice.cancel().catch(() => log.warn('could not cancel recording'));
  }, [platform]);

  const toggle = useCallback(() => {
    if (phaseRef.current === 'idle') void start();
    else if (phaseRef.current === 'listening') stop();
  }, [start, stop]);

  useEffect(() => {
    const subscriptions = [
      platform.voice.on('voice:state', ({ phase: next }) => {
        setPhase(next);
        if (next === 'listening') setStartedAt(Date.now());
        if (next !== 'listening') setLevel(0);
      }),
      platform.voice.on('voice:level', setLevel),
      platform.voice.on('voice:error', ({ code }) => setError(code)),
      platform.voice.on('voice:text', ({ text, seconds, millis }) => {
        log.info('dictation written down', {
          seconds: Math.round(seconds * 10) / 10,
          millis,
          chars: text.length,
        });
        if (!text.trim()) {
          setHeardNothing(true);
          return;
        }
        const { draft, setDraft, setSpoken } = useDockStore.getState();
        const cursor = cursorRef.current ?? draft.length;
        const next = insertDictation(draft, cursor, text);
        setDraft(next.text);
        setSpoken(true);
        const input = inputRef.current;
        if (input) {
          input.focus();
          // After React has put the new value in.
          requestAnimationFrame(() => input.setSelectionRange(next.cursor, next.cursor));
        }
      }),
      platform.voice.on('voice:hold', ({ phase: hold }) => {
        if (hold === 'start') void start();
        else if (phaseRef.current === 'listening' || phaseRef.current === 'starting') stop();
      }),
    ];
    return () => {
      for (const subscription of subscriptions) {
        subscription.then((unlisten) => unlisten()).catch(() => undefined);
      }
    };
  }, [inputRef, platform, start, stop]);

  useEffect(() => {
    if (phase !== 'listening' || startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [phase, startedAt]);

  return { phase, level, elapsed, error, heardNothing, toggle, cancel };
}
