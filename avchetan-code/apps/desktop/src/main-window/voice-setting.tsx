import {
  loadVoiceSettings,
  SPEECH_MODELS,
  type SpeechModel,
  saveVoiceSettings,
  type VoiceSettings,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { GUIDE_URL, openExternal } from '../help';
import { emitAppEvent } from '../native/events';
import { useServices } from '../services-context';
import { ActionError, fieldClass, QuietButton } from './ui';

const log = createLogger('settings');

const settingsKey = ['settings', 'voice'] as const;
const filesKey = ['native', 'voice-models'] as const;
const devicesKey = ['native', 'voice-devices'] as const;

const LANGUAGE_LABELS: Record<WhisperLanguage, string> = {
  auto: 'English or Hindi, detected',
  en: 'English',
  hi: 'Hindi',
};

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Settings → Voice (docs/product/voice-capture.md#settings--voice-pc). */
export function VoiceSetting() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => loadVoiceSettings(store) });
  const save = useMutation({
    mutationFn: (changes: Partial<VoiceSettings>) => saveVoiceSettings(store, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
      // The dock reads them on its next recording; this keeps other windows' views fresh.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce a voice settings change'),
      );
    },
  });
  const current = settings.data;

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Speech model</h2>
        <p className="text-sm text-ink-muted">
          Hold your shortcut, or press 🎤 in the capture box, and talk. A Whisper model on this PC
          turns it into text, offline: your voice never leaves the PC, and the recording is deleted
          as soon as it is text. English and Hindi, mixed as you speak.{' '}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void openExternal(`${GUIDE_URL}/voice`).catch(() => log.warn('could not open a link'))
            }
          >
            How voice works
          </button>
        </p>
        {current ? (
          <ModelList chosen={current.model} onChoose={(model) => save.mutate({ model })} />
        ) : null}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Language</h2>
        <p className="text-sm text-ink-muted">
          Detection chooses between English and Hindi for each recording. Choose Hindi if you mostly
          speak Hindi or Hinglish: it skips detection, so it is quicker and never guesses English by
          mistake.
        </p>
        <select
          aria-label="Language"
          className={`${fieldClass} w-fit`}
          value={current?.language ?? 'auto'}
          onChange={(event) => save.mutate({ language: event.target.value as WhisperLanguage })}
        >
          {WHISPER_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
      </section>
      <MicrophoneSetting
        device={current?.device ?? ''}
        onChoose={(device) => save.mutate({ device })}
      />
      <ActionError errors={[save.error]} />
    </>
  );
}

function ModelList(props: { chosen: string; onChoose: (id: string) => void }) {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  const files = useQuery({
    queryKey: filesKey,
    queryFn: () => platform.voice.modelStatus(SPEECH_MODELS.map((model) => model.file)),
  });
  const [progress, setProgress] = useState<{ id: string; received: number; total: number } | null>(
    null,
  );
  useEffect(() => {
    const subscription = platform.voice.on('voice:download', setProgress);
    return () => {
      subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [platform]);

  const download = useMutation({
    mutationFn: (model: SpeechModel) => platform.voice.downloadModel(model),
    onSuccess: (_, model) => props.onChoose(model.id),
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: filesKey });
    },
  });
  const remove = useMutation({
    mutationFn: async (model: SpeechModel) => {
      await platform.voice.deleteModel(model.file);
      if (props.chosen === model.id) props.onChoose('');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: filesKey }),
  });
  const cancelled = download.error && toAppError(download.error).code === 'cancelled';

  return (
    <div className="flex flex-col gap-2">
      {SPEECH_MODELS.map((model) => {
        const present = files.data?.find((file) => file.file === model.file)?.present ?? false;
        const downloading = download.isPending && download.variables?.id === model.id;
        const shown = progress?.id === model.id ? progress : null;
        return (
          <div key={model.id} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="speech-model"
                checked={present && props.chosen === model.id}
                disabled={!present}
                onChange={() => props.onChoose(model.id)}
              />
              <span>
                {model.label} <span className="text-ink-muted">({megabytes(model.sizeBytes)})</span>
              </span>
            </label>
            {present ? (
              <QuietButton disabled={remove.isPending} onClick={() => remove.mutate(model)}>
                Delete
              </QuietButton>
            ) : downloading ? (
              <>
                <progress
                  className="h-2 w-32"
                  value={shown?.received ?? 0}
                  max={shown?.total ?? model.sizeBytes}
                />
                <span className="text-xs text-ink-muted">
                  {megabytes(shown?.received ?? 0)} of {megabytes(model.sizeBytes)}
                </span>
                <QuietButton
                  onClick={() =>
                    void platform.voice
                      .cancelDownload()
                      .catch(() => log.warn('could not cancel the download'))
                  }
                >
                  Cancel
                </QuietButton>
              </>
            ) : (
              <QuietButton disabled={download.isPending} onClick={() => download.mutate(model)}>
                Download
              </QuietButton>
            )}
          </div>
        );
      })}
      {files.data && !files.data.some((file) => file.present) ? (
        <p className="text-sm text-ink-muted">
          Nothing downloaded yet. If you speak Hindi or Hinglish, choose the second one.
        </p>
      ) : null}
      {cancelled ? null : <ActionError errors={[download.error, remove.error]} />}
    </div>
  );
}

function MicrophoneSetting(props: { device: string; onChoose: (device: string) => void }) {
  const { platform } = useServices();
  const devices = useQuery({ queryKey: devicesKey, queryFn: () => platform.voice.devices() });
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [testError, setTestError] = useState<unknown>(null);

  useEffect(() => {
    if (!testing) return;
    const subscription = platform.voice.on('voice:level', setLevel);
    // A test only shows the level; stop it after a few seconds.
    const timer = setTimeout(() => setTesting(false), 8000);
    platform.voice
      .start({ file: '', language: 'auto', device: props.device, test: true })
      .catch((error) => {
        setTestError(error);
        setTesting(false);
      });
    return () => {
      clearTimeout(timer);
      setLevel(0);
      platform.voice.cancel().catch(() => log.warn('could not stop the microphone test'));
      subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [testing, platform, props.device]);

  const chosenMissing =
    props.device !== '' && devices.data && !devices.data.some((d) => d.name === props.device);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Microphone</h2>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Microphone"
          className={fieldClass}
          value={props.device}
          onChange={(event) => props.onChoose(event.target.value)}
          onFocus={() => void devices.refetch()}
        >
          <option value="">Windows default</option>
          {chosenMissing ? (
            <option value={props.device}>{props.device} (not connected)</option>
          ) : null}
          {(devices.data ?? []).map((device) => (
            <option key={device.name} value={device.name}>
              {device.name}
              {device.default ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <QuietButton
          onClick={() => {
            setTestError(null);
            setTesting((on) => !on);
          }}
        >
          {testing ? 'Stop test' : 'Test'}
        </QuietButton>
        {testing ? (
          <meter aria-label="Microphone level" className="h-2 w-32" min={0} max={1} value={level} />
        ) : null}
      </div>
      {testing ? (
        <p className="text-xs text-ink-muted">Say something: the bar should move.</p>
      ) : null}
      <ActionError errors={[testError, devices.error]} />
    </section>
  );
}
