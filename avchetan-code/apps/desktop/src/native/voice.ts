import type { SpeechModel, WhisperLanguage } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const log = createLogger('voice');

/** Events from src-tauri/src/voice.rs and hotkey.rs, sent to the window that started recording. */
export const voiceEventSchemas = {
  'voice:state': z.object({ phase: z.enum(['listening', 'transcribing', 'idle']) }),
  /** 0–1, about 16 times a second while listening. */
  'voice:level': z.number().min(0).max(1),
  /** The words heard (empty when nothing was), with timings for the log. Never logged itself. */
  'voice:text': z.object({ text: z.string(), seconds: z.number(), millis: z.number() }),
  'voice:error': z.object({ code: z.string() }),
  /** To every window. */
  'voice:download': z.object({ id: z.string(), received: z.number(), total: z.number() }),
  /** The dock shortcut held (start) and let go (end); to the dock only. */
  'voice:hold': z.object({ phase: z.enum(['start', 'end']) }),
};
export type VoiceEvents = {
  [K in keyof typeof voiceEventSchemas]: z.infer<(typeof voiceEventSchemas)[K]>;
};
export type VoicePhase = VoiceEvents['voice:state']['phase'];

const modelFileSchema = z.object({ file: z.string(), present: z.boolean(), bytes: z.number() });
export type ModelFile = z.infer<typeof modelFileSchema>;
const microphoneSchema = z.object({ name: z.string(), default: z.boolean() });
export type Microphone = z.infer<typeof microphoneSchema>;

export type StartRecording = {
  /** The speech model's file; ignored for a test. */
  file: string;
  language: WhisperLanguage;
  /** '' for the Windows default. */
  device: string;
  /** Shows the level only; nothing is turned into text. */
  test?: boolean;
};

/** Voice capture's native side (docs/product/voice-capture.md). */
export function createVoice(invoke: Invoke) {
  return {
    start: (request: StartRecording) =>
      callNative(invoke, 'voice_start', { request: { test: false, ...request } }, z.null()),
    stop: () => callNative(invoke, 'voice_stop', {}, z.null()),
    cancel: () => callNative(invoke, 'voice_cancel', {}, z.null()),
    devices: () => callNative(invoke, 'voice_devices', {}, z.array(microphoneSchema)),
    modelStatus: (files: string[]) =>
      callNative(invoke, 'voice_model_status', { files }, z.array(modelFileSchema)),
    deleteModel: (file: string) => callNative(invoke, 'voice_model_delete', { file }, z.null()),
    /** Resolves once the model is downloaded and its checksum matches. */
    downloadModel: (model: SpeechModel) =>
      callNative(
        invoke,
        'voice_model_download',
        {
          request: {
            id: model.id,
            file: model.file,
            url: model.url,
            sha256: model.sha256,
            sizeBytes: model.sizeBytes,
          },
        },
        z.null(),
      ),
    cancelDownload: () => callNative(invoke, 'voice_model_download_cancel', {}, z.null()),
    /** Listens on this window only: recordings report to the window that started them. */
    on<K extends keyof VoiceEvents>(
      name: K,
      handler: (payload: VoiceEvents[K]) => void,
    ): Promise<UnlistenFn> {
      const callback: EventCallback<unknown> = (event) => {
        const parsed = voiceEventSchemas[name].safeParse(event.payload);
        if (!parsed.success) {
          log.warn('dropped voice event with invalid payload', { event: name });
          return;
        }
        handler(parsed.data as VoiceEvents[K]);
      };
      return getCurrentWebviewWindow().listen(name, callback);
    },
  };
}

export type Voice = ReturnType<typeof createVoice>;
