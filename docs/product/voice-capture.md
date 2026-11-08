# Voice capture

Say an entry instead of typing it. On the PC, hold your shortcut (or press the mic in the dock) and talk. A Whisper model runs inside the app, offline, and the text lands in the dock for you to check before saving. On the phone, tap the mic in the app or on the widget. Android's own on-device recognizer writes the text into the capture box the same way. Audio never leaves the device and is deleted as soon as the text exists. This is item 1 of [Phase 7](../roadmap.md#phase-7--advancements-b-voice-graph-patterns-privacy-), and it replaces the outline in [advancements §4](advancements.md#4-voice-capture-whisper).

## Why

Typing is the slowest part of capture when your hands are busy or the thought is long. Voice has to keep the same promises as typing:

- **Capture never waits on the network** (rule 1): speech becomes text on the device.
- **Zero paid services** (rule 13): whisper.cpp and Android's recognizer are free and work offline.
- **Privacy:** no audio is uploaded or kept.

## Decisions (2026-11-07)

| Question | Decision |
|---|---|
| PC engine | whisper.cpp built into the desktop app (Rust). The model is downloaded once from Settings. Works in every mode, including Standalone. |
| Phone engine | Android's built-in recognizer, **on-device only**. No audio is recorded by the app. |
| Languages | English and Hindi, mixed freely. Multilingual Whisper models only. |
| Hindi script | As spoken: Hindi in Devanagari, English words in English. No transliteration or translation. |
| PC trigger | Both: **hold** the dock shortcut for quick notes, and a **mic button** in the dock (press to start, press to stop) for longer ones. |
| Phone flow | A mic in the app's capture box and on the widget. The text always lands in the box for review; you tap **Save**. |
| Audio | Deleted as soon as the text exists. No "keep audio" switch. |

## What it looks like

### PC

```
┌ Avchetan dock ─────────────────────────────────────────┐
│ ● Listening…  0:07                     [■ Stop]       │
│ ▁▃▅▂▆▃▁                                               │
└────────────────────────────────────────────────────────┘
            ↓ let go / Stop
┌ Avchetan dock ─────────────────────────────────────────┐
│ आज gym में 40 minute running की, knee ठीक थी           │
│                                   🎤   Enter to save   │
└────────────────────────────────────────────────────────┘
```

- **Hold `Ctrl+Shift+Space`** (your dock shortcut, whatever it is set to). A short press opens or closes the dock as it does now. If you hold it for longer than about 0.4 s, the dock opens and shows *Listening…*. Let go to stop.
- **Mic button** at the right of the dock's capture box (🎤). Press it to start and press it again (or **Stop**, or Esc to cancel) to stop. It suits longer thoughts. Recording stops by itself after 5 minutes.
- **After you stop:** *Writing it down…* shows while Whisper works (a few seconds on a CPU). Then the text is put into the box where the cursor is, so you can also dictate into a half-typed entry. Nothing is saved until you press your save key, as with typed text.
- An entry whose text came from speech is saved with source `desktop_voice`, even if you edited it.
- **No speech model yet:** the mic button and a held shortcut show *Voice needs a speech model* with **Set up**, which opens Settings → Voice.

### Phone

- **Mic** in the capture box (app and widget). Tap it and talk; tap again or pause to stop. The words appear in the box as Android hears them. Tap **Save** as usual.
- **Widget mic:** opens the capture screen already listening (`avchetan://capture?from=widget&voice=1`). **Save** sends the app to the background, as the widget bar does now.
- Source `mobile_voice` when the text came from speech.
- **No offline speech on this phone** (the language isn't downloaded, or the phone has no on-device recognizer): *This phone can't recognise speech offline* with steps to download the language in Android settings. The app never falls back to Google's online recognizer.

### Settings → Voice (PC)

- **Speech model:** *Off* · *Fast; good for English, weak for Hindi* (base, about 150 MB) · *Better for Hindi and Hinglish; a few seconds slower* (small q5_1, about 190 MB). **Download** shows progress and can be cancelled. **Delete** frees the space.
- **Language:** *English or Hindi, detected* (default) · *English* · *Hindi*. Detection only chooses between English and Hindi (Urdu counts as Hindi): left to itself, Whisper wrote Hindi speech as Urdu or Chinese in the first real test. For Hindi, Whisper gets a short made-up Hinglish sentence as its initial prompt, so Hindi stays in Devanagari and English words in English letters.
- Measured on a 14-core laptop CPU, 6.8 s of English: base 1.8 s, small 6.1 s, large-v3-turbo (q5_0) 32 s. Turbo is too slow on a CPU for dictation and isn't offered. Shrinking Whisper's 30 s window (`audio_ctx`) saved about 30% but made turbo repeat itself, so it isn't used.
- **Microphone:** *Windows default* or a named device, with a **Test** button that shows the level.

### More → Voice (phone)

- **Language:** *Hindi + English (switches as you speak)* (default, `mixed`) · *English (India)* (`en-IN`) · *Hindi* (`hi-IN`) · *Phone language*. Google's `hi-IN` recognizer writes English words in Devanagari too (first real test), so `mixed` starts in `en-IN` and allows a switch to `hi-IN` (`EXTRA_ENABLE_LANGUAGE_SWITCH`, Android 14+; below 14 it is `en-IN` only). It shows whether each language it needs is ready offline, with a Download button for each that isn't.

## How it's built

### Desktop (Rust, `apps/desktop/src-tauri`)

- **`voice.rs`:** records with `cpal` (WASAPI) as 16 kHz mono f32 samples, held in memory and never written to disk. It transcribes with `whisper-rs` (whisper.cpp, CPU build) on a background thread.
- **Commands:**
  - `voice_start`, `voice_stop`, `voice_cancel`.
  - `voice_model_status`, `voice_model_download` (with progress events), `voice_model_delete`, `voice_devices`.
  - Events: `voice:level`, `voice:state` (`listening` / `transcribing` / `idle`), `voice:text`.
  - Results are Zod-validated on the TS side (rule 9).
- **Model files** go in the app's data folder under `models/whisper/`. A download is checked against its SHA-256 before use. A partial or mismatched download is deleted.
- **Model sources** (URL, SHA-256, size, label) live in `packages/core/src/models/presets.json` (rule 6), never in Rust or TS source.
- The model is loaded on first use and unloaded after 10 minutes idle, to keep memory free.
- **Hold to talk:** the global-shortcut handler now acts on both `Pressed` and `Released`:
  - Press: the dock acts as now.
  - Still held after 400 ms: start recording.
  - Release: stop and transcribe.
  - Key auto-repeat while held is ignored. Verify release events on Windows first, before any UI work. If they are unreliable, the shortcut falls back to toggling, and holding is documented as unavailable.
- **Language:** `auto` passes no language to Whisper; `en` and `hi` force one. Whisper's translate mode is off.

### Desktop webview

- `dock/use-voice.ts`: state, the level meter, and inserting the text at the cursor.
- Capture passes `source: 'desktop_voice'` when the draft contains voice text.
- Settings tab **Voice** goes between Capture box and Daily brief.

### Phone (`apps/mobile`)

- `expo-speech-recognition` (MIT) with `requiresOnDeviceRecognition: true` and `interimResults`. `getSupportedLocales()` decides whether *ready offline* shows. Its config plugin adds `RECORD_AUDIO`.
- The capture screen's mic and `voice=1` deep link. The widget layout gains a mic button (`plugins/capture-widget.js`).
- `MobileSource` gains `mobile_voice`.

### Shared

- `raw_logs.source` already has `desktop_voice` and `mobile_voice`.
- Settings are client-local: `voice.model`, `voice.language`, `voice.device` (desktop) and `voice.language` (phone).
- The `transcription` model slot in [llm-engine](../architecture/llm-engine.md#model-slots) changes meaning to "on-device speech". No cloud transcription in this version.
- **Logs:** durations, sample counts, model id, and errors. Never the text (rule 11).
- **Licenses:** whisper.cpp and the Whisper models (MIT), `whisper-rs` (Unlicense), `cpal` (Apache-2.0), `expo-speech-recognition` (MIT). All are AGPL-compatible. Pin the latest stable versions when building, and check `licenses:check`.
- **Build:** whisper.cpp builds from source through `whisper-rs-sys` (CMake, MSVC, and libclang for its bindings: the bundled ones are generated on Linux and get Windows type sizes wrong). `src-tauri/.cargo/config.toml` builds it for AVX2 rather than the build machine's CPU, and sets `/O2` (cmake-rs leaves MSVC Release flags unoptimized, about 8× slower). `voice_start` refuses on a CPU without AVX2 (`speech_unsupported_cpu`). CI sets `LIBCLANG_PATH` to the runner's LLVM.

## Errors

Each gets an `ERROR_HELP` entry, a section in [troubleshooting](../user-guide/troubleshooting.md), and a fix in the message:

| Code | Shown as | Fix |
|---|---|---|
| `mic_unavailable` | No microphone found | Plug one in or pick one in Settings → Voice |
| `mic_permission_denied` | Windows or Android blocked the microphone | Windows: Settings → Privacy & security → Microphone → *Let desktop apps access your microphone*. Android: allow the microphone for Avchetan |
| `speech_model_missing` | Voice needs a speech model | Settings → Voice → Download |
| `speech_model_download_failed` | The speech model didn't download | Check the connection and try again (a partial file is removed) |
| `speech_offline_unavailable` | This phone can't recognise speech offline | Download the language in Android's speech settings |
| `speech_unsupported_cpu` | This PC's processor is too old for voice | Use voice on the phone; typing still works (needs AVX2, about 2013 on) |
| `transcription_failed` | Couldn't turn that into text | Try again. If it keeps failing, re-download the model |

## Data changes

None. The sources exist, and settings are client-local.

## Done when

- On the PC with no network, holding the shortcut or using the mic button turns English, Hindi and mixed speech into text in the dock. Enter saves it with source `desktop_voice`. No audio file is left anywhere.
- The model downloads from Settings → Voice with a SHA-256 check, and can be deleted. Without a model, the mic explains how to set one up.
- On the phone in flight mode (with the language downloaded), the app mic and the widget mic fill the capture box. Save stores `mobile_voice`.
- A short press of the shortcut still opens and closes the dock as before.
- Every error above has its help entry and troubleshooting section (`pnpm errors:check`).
- The user guide has a [Voice](../user-guide/README.md) page (PC and phone), and [Capture on Windows](../user-guide/capture-on-windows.md), [Capture on Android](../user-guide/capture-on-android.md) and [Privacy](../user-guide/privacy.md) mention it.

## Not in this version

- Cloud transcription (Groq or OpenAI Whisper), and audio waiting for it offline (`pending_transcription`). Both apps work offline without it.
- The hub transcribing for the phone.
- Saving straight from the widget with Undo.
- Keeping audio.
- GPU builds of whisper.cpp (CUDA or Vulkan). CPU only for now.
- Roman (Hinglish) output or translation into English.
- Wake words, or continuous dictation beyond 5 minutes.
