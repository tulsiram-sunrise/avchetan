import { createLogger, describeError } from '@avchetan/shared';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import type { VoiceUi } from './use-voice';

const log = createLogger('voice');

/** The mic button at the right of the capture box (voice-capture.md). */
export function MicButton(props: { voice: VoiceUi }) {
  const { phase, toggle } = props.voice;
  const listening = phase === 'listening';
  const busy = phase === 'starting' || phase === 'transcribing';
  return (
    <button
      type="button"
      aria-label={listening ? 'Stop and write it down' : 'Talk instead of typing'}
      title={listening ? 'Stop' : 'Talk (or hold your shortcut)'}
      aria-pressed={listening}
      disabled={busy}
      onClick={toggle}
      className={`rounded-full px-2 py-0.5 text-sm ${
        listening ? 'bg-danger/20 text-danger' : 'text-ink-muted hover:bg-surface-raised'
      } disabled:opacity-50`}
    >
      {listening ? '■' : '🎤'}
    </button>
  );
}

function openVoiceSettings() {
  emitAppEvent('main:navigate', { view: 'settings', tab: 'voice' }).catch(() =>
    log.warn('could not open voice settings'),
  );
}

const BARS = 7;

/** What voice is doing, under the capture box. Nothing while idle and fine. */
export function VoiceLine(props: { voice: VoiceUi }) {
  const { phase, level, elapsed, error, heardNothing, toggle, cancel } = props.voice;
  if (phase === 'listening' || phase === 'starting') {
    const minutes = Math.floor(elapsed / 60);
    const seconds = String(elapsed % 60).padStart(2, '0');
    return (
      <div role="status" className="flex items-center gap-2 px-1 pt-1 text-xs text-ink-muted">
        <span className="text-danger">●</span>
        <span>
          Listening… {minutes}:{seconds}
        </span>
        <span aria-hidden className="flex h-3 items-end gap-0.5">
          {Array.from({ length: BARS }, (_, index) => {
            // A small wave around the level, so the meter looks alive.
            const shape = 0.55 + 0.45 * Math.sin((index / (BARS - 1)) * Math.PI);
            const height = Math.max(0.15, Math.min(1, level * shape));
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars that never reorder
                key={index}
                className="w-0.5 rounded bg-accent"
                style={{ height: `${height * 100}%` }}
              />
            );
          })}
        </span>
        <button type="button" className="ml-auto underline" onClick={toggle}>
          Stop
        </button>
        <button type="button" className="underline" onClick={cancel}>
          Cancel (Esc)
        </button>
      </div>
    );
  }
  if (phase === 'transcribing') {
    return (
      <p role="status" className="px-1 pt-1 text-xs text-ink-muted">
        Writing it down…
      </p>
    );
  }
  if (error === 'speech_model_missing') {
    return (
      <p role="alert" className="px-1 pt-1 text-xs text-ink-muted">
        Voice needs a speech model.{' '}
        <button type="button" className="text-accent underline" onClick={openVoiceSettings}>
          Set up
        </button>
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="px-1 pt-1 text-xs text-danger">
        {describeError({ code: error, message: 'Voice didn’t work this time. Try again' }).message}.{' '}
        <HelpLink code={error} />
      </p>
    );
  }
  if (heardNothing) {
    return (
      <p role="status" className="px-1 pt-1 text-xs text-ink-muted">
        Didn’t hear anything. Check the microphone in Settings → Voice.
      </p>
    );
  }
  return null;
}
