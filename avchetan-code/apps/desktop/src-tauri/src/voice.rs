//! Voice capture (docs/product/voice-capture.md): records the microphone into memory and turns
//! it into text with whisper.cpp, offline. Audio is never written to disk, and the text is only
//! sent to the window that asked for it. Speech models are downloaded on request into
//! `models/whisper/` and checked against their SHA-256 before use. Which model, where it comes
//! from and its checksum come from the webview (presets.json); nothing here names a model.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, SampleFormat, SizedSample, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window};
use tauri_plugin_http::reqwest;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::{CommandError, CommandResult};

const MODELS_FOLDER: &str = "models/whisper";
/// Whisper's input rate.
const WHISPER_RATE: u32 = 16_000;
/// A recording stops by itself after this long.
const MAX_RECORDING: Duration = Duration::from_secs(5 * 60);
/// A loaded model is dropped after this long unused, to give the memory back.
const UNLOAD_AFTER: Duration = Duration::from_secs(10 * 60);
/// How often the level meter is updated.
const LEVEL_EVERY: Duration = Duration::from_millis(60);
/// Less than this much audio is treated as nothing said.
const MIN_SAMPLES: usize = (WHISPER_RATE / 4) as usize;
/// Only these hosts are downloaded from (the URLs themselves live in presets.json).
const MODEL_HOSTS: [&str; 1] = ["https://huggingface.co/"];

pub const EVENT_STATE: &str = "voice:state";
pub const EVENT_LEVEL: &str = "voice:level";
pub const EVENT_TEXT: &str = "voice:text";
pub const EVENT_ERROR: &str = "voice:error";
pub const EVENT_DOWNLOAD: &str = "voice:download";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Finish {
    Transcribe,
    Cancel,
}

struct Recording {
    finish: Sender<Finish>,
}

struct LoadedModel {
    path: PathBuf,
    context: Arc<WhisperContext>,
}

#[derive(Default)]
struct Inner {
    recording: Option<Recording>,
    model: Option<LoadedModel>,
}

pub struct VoiceState {
    models_dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
    /// Bumped on every use of the model; the unload timer only drops a model nobody touched.
    used: Arc<AtomicU64>,
    downloading: AtomicBool,
    cancel_download: Arc<AtomicBool>,
}

impl VoiceState {
    pub fn new(data_dir: &Path) -> Self {
        whisper_rs::install_logging_hooks();
        Self {
            models_dir: data_dir.join(MODELS_FOLDER),
            inner: Arc::default(),
            used: Arc::default(),
            downloading: AtomicBool::new(false),
            cancel_download: Arc::default(),
        }
    }

    fn model_path(&self, file: &str) -> CommandResult<PathBuf> {
        if !valid_file_name(file) {
            return Err(CommandError::new("invalid_input", "not a model file name"));
        }
        Ok(self.models_dir.join(file))
    }
}

/// Model files are plain names such as `ggml-base.bin`: no folders, so nothing outside
/// `models/whisper/` can be read, written or deleted.
fn valid_file_name(file: &str) -> bool {
    !file.is_empty()
        && file.len() <= 100
        && file.ends_with(".bin")
        && !file.starts_with('.')
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Listening,
    Transcribing,
    Idle,
}

#[derive(Serialize, Clone)]
struct StatePayload {
    phase: Phase,
}

#[derive(Serialize, Clone)]
struct ErrorPayload {
    code: &'static str,
}

#[derive(Serialize, Clone)]
struct TextPayload {
    text: String,
    /// Seconds of audio, for the log line on the TS side.
    seconds: f32,
    millis: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    /// The model file in `models/whisper/`; ignored for a microphone test.
    file: String,
    /// `auto`, or a Whisper language code such as `en` or `hi`.
    language: String,
    /// A microphone name, or empty for the default.
    device: String,
    /// A microphone test: shows the level, never transcribes.
    #[serde(default)]
    test: bool,
}

/// Starts recording. Errors about the microphone or a missing model come back here; what
/// happens after (text, or a transcription error) comes as events to the calling window.
#[tauri::command]
pub fn voice_start<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    state: State<'_, VoiceState>,
    request: StartRequest,
) -> CommandResult<()> {
    let language = match request.language.as_str() {
        "auto" => None,
        code if code.len() <= 3 && code.chars().all(|c| c.is_ascii_lowercase()) => {
            Some(code.to_owned())
        }
        _ => return Err(CommandError::new("invalid_input", "unknown language")),
    };
    let model_path = if request.test {
        None
    } else {
        if !cpu_supported() {
            return Err(CommandError::new(
                "speech_unsupported_cpu",
                "this PC's processor is too old for the speech model",
            ));
        }
        let path = state.model_path(&request.file)?;
        if !path.is_file() {
            return Err(CommandError::new(
                "speech_model_missing",
                "the speech model isn't downloaded",
            ));
        }
        Some(path)
    };

    let mut inner = state.inner.lock().map_err(|_| busy())?;
    if inner.recording.is_some() {
        return Ok(());
    }
    let (finish_tx, finish_rx) = mpsc::channel::<Finish>();
    let (ready_tx, ready_rx) = mpsc::channel::<CommandResult<()>>();
    let label = window.label().to_owned();
    let shared = Arc::clone(&state.inner);
    let used = Arc::clone(&state.used);
    let device = request.device;

    thread::spawn(move || {
        let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let (stream, rate) = match open_stream(&app, &label, &device, Arc::clone(&samples)) {
            Ok(opened) => opened,
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));
        emit_phase(&app, &label, Phase::Listening);

        let finish = match finish_rx.recv_timeout(MAX_RECORDING) {
            Ok(finish) => finish,
            Err(RecvTimeoutError::Timeout) => Finish::Transcribe,
            Err(RecvTimeoutError::Disconnected) => Finish::Cancel,
        };
        drop(stream);
        if let Ok(mut inner) = shared.lock() {
            inner.recording = None;
        }
        let recorded = samples.lock().map(|mut s| std::mem::take(&mut *s));
        let Some(model_path) = model_path.filter(|_| finish == Finish::Transcribe) else {
            emit_phase(&app, &label, Phase::Idle);
            return;
        };
        let audio = to_whisper_rate(&recorded.unwrap_or_default(), rate);
        if audio.len() < MIN_SAMPLES {
            emit_text(&app, &label, String::new(), 0.0, 0);
            emit_phase(&app, &label, Phase::Idle);
            return;
        }
        emit_phase(&app, &label, Phase::Transcribing);
        let started = Instant::now();
        match transcribe(&shared, &used, &model_path, language.as_deref(), &audio) {
            Ok(text) => emit_text(
                &app,
                &label,
                text,
                audio.len() as f32 / WHISPER_RATE as f32,
                u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            ),
            Err(code) => {
                warn_on_emit(app.emit_to(&label, EVENT_ERROR, ErrorPayload { code }));
            }
        }
        emit_phase(&app, &label, Phase::Idle);
        schedule_unload(shared, used);
    });

    match ready_rx.recv() {
        Ok(Ok(())) => {
            inner.recording = Some(Recording { finish: finish_tx });
            Ok(())
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(CommandError::new("mic_unavailable", "the recorder stopped")),
    }
}

/// Stops recording and turns it into text.
#[tauri::command]
pub fn voice_stop(state: State<'_, VoiceState>) -> CommandResult<()> {
    finish(&state, Finish::Transcribe)
}

/// Stops recording and throws the audio away.
#[tauri::command]
pub fn voice_cancel(state: State<'_, VoiceState>) -> CommandResult<()> {
    finish(&state, Finish::Cancel)
}

fn finish(state: &VoiceState, how: Finish) -> CommandResult<()> {
    let inner = state.inner.lock().map_err(|_| busy())?;
    if let Some(recording) = &inner.recording {
        // The thread may have stopped on its own (time limit) a moment ago; that's fine.
        let _ = recording.finish.send(how);
    }
    Ok(())
}

/// whisper.cpp is built for AVX2 and FMA (.cargo/config.toml); without them it would crash.
fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2")
            && std::arch::is_x86_feature_detected!("fma")
            && std::arch::is_x86_feature_detected!("f16c")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        true
    }
}

fn busy() -> CommandError {
    CommandError::new("voice_unavailable", "voice is unavailable")
}

fn emit_phase<R: Runtime>(app: &AppHandle<R>, label: &str, phase: Phase) {
    warn_on_emit(app.emit_to(label, EVENT_STATE, StatePayload { phase }));
}

fn emit_text<R: Runtime>(app: &AppHandle<R>, label: &str, text: String, seconds: f32, millis: u64) {
    warn_on_emit(app.emit_to(
        label,
        EVENT_TEXT,
        TextPayload {
            text,
            seconds,
            millis,
        },
    ));
}

fn warn_on_emit(result: tauri::Result<()>) {
    crate::error::warn_on_err("voice event", result);
}

fn mic_error(error: &cpal::Error) -> CommandError {
    match error.kind() {
        ErrorKind::PermissionDenied => CommandError::new(
            "mic_permission_denied",
            "Windows blocked the microphone for desktop apps",
        ),
        _ => CommandError::new("mic_unavailable", format!("microphone: {error}")),
    }
}

fn find_device(name: &str) -> CommandResult<cpal::Device> {
    let host = cpal::default_host();
    if !name.is_empty() {
        let devices = host.input_devices().map_err(|e| mic_error(&e))?;
        for device in devices {
            if device.description().is_ok_and(|d| d.name() == name) {
                return Ok(device);
            }
        }
    }
    // A chosen microphone that was unplugged falls back to the default.
    host.default_input_device()
        .ok_or_else(|| CommandError::new("mic_unavailable", "no microphone found"))
}

/// Opens the microphone. Samples arrive mono, at the device's rate; the level goes to `label`.
fn open_stream<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    device: &str,
    samples: Arc<Mutex<Vec<f32>>>,
) -> CommandResult<(Stream, u32)> {
    let device = find_device(device)?;
    let config = device.default_input_config().map_err(|e| mic_error(&e))?;
    let rate = config.sample_rate();
    let channels = usize::from(config.channels()).max(1);
    let level = LevelMeter::new(app.clone(), label.to_owned());
    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32, R>(&device, &config.config(), channels, samples, level),
        SampleFormat::I16 => build::<i16, R>(&device, &config.config(), channels, samples, level),
        SampleFormat::U16 => build::<u16, R>(&device, &config.config(), channels, samples, level),
        SampleFormat::I32 => build::<i32, R>(&device, &config.config(), channels, samples, level),
        other => {
            return Err(CommandError::new(
                "mic_unavailable",
                format!("unsupported microphone format {other}"),
            ))
        }
    }
    .map_err(|e| mic_error(&e))?;
    stream.play().map_err(|e| mic_error(&e))?;
    Ok((stream, rate))
}

fn build<T, R: Runtime>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
    mut level: LevelMeter<R>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    let max = MAX_RECORDING.as_secs() as usize * config.sample_rate as usize + 1;
    device.build_input_stream::<T, _, _>(
        *config,
        move |data: &[T], _| {
            let mono = downmix(data, channels);
            level.push(&mono);
            if let Ok(mut all) = samples.lock() {
                if all.len() < max {
                    all.extend_from_slice(&mono);
                }
            }
        },
        |error| eprintln!("[avchetan] microphone: {error}"),
        None,
    )
}

/// Averages interleaved channels into one.
fn downmix<T>(data: &[T], channels: usize) -> Vec<f32>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    data.chunks(channels)
        .map(|frame| {
            frame
                .iter()
                .map(|s| <f32 as cpal::FromSample<T>>::from_sample_(*s))
                .sum::<f32>()
                / frame.len() as f32
        })
        .collect()
}

struct LevelMeter<R: Runtime> {
    app: AppHandle<R>,
    label: String,
    last: Instant,
    peak: f32,
}

impl<R: Runtime> LevelMeter<R> {
    fn new(app: AppHandle<R>, label: String) -> Self {
        Self {
            app,
            label,
            last: Instant::now(),
            peak: 0.0,
        }
    }

    fn push(&mut self, mono: &[f32]) {
        let rms = (mono.iter().map(|s| s * s).sum::<f32>() / mono.len().max(1) as f32).sqrt();
        self.peak = self.peak.max(rms);
        if self.last.elapsed() >= LEVEL_EVERY {
            let _ = self
                .app
                .emit_to(&self.label, EVENT_LEVEL, meter_level(self.peak));
            self.peak = 0.0;
            self.last = Instant::now();
        }
    }
}

/// RMS → 0-1 for the meter, on a decibel scale (-60 dB to -10 dB), so a quiet microphone still
/// moves it and silence doesn't.
fn meter_level(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() + 60.0) / 50.0).clamp(0.0, 1.0)
}

/// Linear resampling to 16 kHz: plenty for speech, and no extra dependency.
fn to_whisper_rate(samples: &[f32], rate: u32) -> Vec<f32> {
    if rate == WHISPER_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let step = f64::from(rate) / f64::from(WHISPER_RATE);
    let count = (samples.len() as f64 / step).floor() as usize;
    (0..count)
        .map(|i| {
            let at = i as f64 * step;
            let index = at.floor() as usize;
            let frac = (at - index as f64) as f32;
            let a = samples[index];
            let b = *samples.get(index + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}

fn transcribe(
    shared: &Mutex<Inner>,
    used: &AtomicU64,
    path: &Path,
    language: Option<&str>,
    audio: &[f32],
) -> Result<String, &'static str> {
    used.fetch_add(1, Ordering::SeqCst);
    let context = {
        let mut inner = shared.lock().map_err(|_| "transcription_failed")?;
        match &inner.model {
            Some(model) if model.path == path => Arc::clone(&model.context),
            _ => {
                let path_str = path.to_str().ok_or("transcription_failed")?;
                let context =
                    WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
                        .map_err(|error| {
                            eprintln!("[avchetan] speech model didn't load: {error}");
                            "transcription_failed"
                        })?;
                let context = Arc::new(context);
                inner.model = Some(LoadedModel {
                    path: path.to_owned(),
                    context: Arc::clone(&context),
                });
                context
            }
        }
    };
    let mut state = context.create_state().map_err(|_| "transcription_failed")?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = thread::available_parallelism().map_or(4, |n| n.get().min(8));
    params.set_n_threads(i32::try_from(threads).unwrap_or(4));
    params.set_language(language.or(Some("auto")));
    params.set_translate(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state.full(params, audio).map_err(|error| {
        eprintln!("[avchetan] transcription failed: {error}");
        "transcription_failed"
    })?;
    let mut text = String::new();
    for segment in state.as_iter() {
        if let Ok(part) = segment.to_str_lossy() {
            text.push_str(&part);
        }
    }
    used.fetch_add(1, Ordering::SeqCst);
    Ok(clean_transcript(&text))
}

/// Whisper marks silence and noise with bracketed tags such as `[BLANK_AUDIO]` or `(music)`;
/// those aren't words someone said.
fn clean_transcript(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0u32;
    for c in text.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn schedule_unload(shared: Arc<Mutex<Inner>>, used: Arc<AtomicU64>) {
    let seen = used.load(Ordering::SeqCst);
    thread::spawn(move || {
        thread::sleep(UNLOAD_AFTER);
        if used.load(Ordering::SeqCst) == seen {
            if let Ok(mut inner) = shared.lock() {
                inner.model = None;
            }
        }
    });
}

// ---------- Microphones ----------

#[derive(Serialize)]
pub struct Microphone {
    name: String,
    default: bool,
}

#[tauri::command]
pub fn voice_devices() -> CommandResult<Vec<Microphone>> {
    let host = cpal::default_host();
    let default = host
        .default_input_device()
        .and_then(|d| d.description().ok())
        .map(|d| d.name().to_owned());
    let devices = host.input_devices().map_err(|e| mic_error(&e))?;
    Ok(devices
        .filter_map(|device| device.description().ok())
        .map(|d| Microphone {
            default: default.as_deref() == Some(d.name()),
            name: d.name().to_owned(),
        })
        .collect())
}

// ---------- Speech models ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    file: String,
    present: bool,
    bytes: u64,
}

#[tauri::command]
pub fn voice_model_status(
    state: State<'_, VoiceState>,
    files: Vec<String>,
) -> CommandResult<Vec<ModelFile>> {
    files
        .into_iter()
        .map(|file| {
            let path = state.model_path(&file)?;
            let bytes = fs::metadata(&path).map(|m| m.len()).ok();
            Ok(ModelFile {
                file,
                present: bytes.is_some(),
                bytes: bytes.unwrap_or(0),
            })
        })
        .collect()
}

#[tauri::command]
pub fn voice_model_delete(state: State<'_, VoiceState>, file: String) -> CommandResult<()> {
    let path = state.model_path(&file)?;
    if let Ok(mut inner) = state.inner.lock() {
        if inner.model.as_ref().is_some_and(|m| m.path == path) {
            inner.model = None;
        }
    }
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::new(
            "speech_model_delete_failed",
            format!("couldn't delete the model: {error}"),
        )),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    id: String,
    file: String,
    url: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    received: u64,
    total: u64,
}

#[tauri::command]
pub async fn voice_model_download<R: Runtime>(
    app: AppHandle<R>,
    request: DownloadRequest,
) -> CommandResult<()> {
    let state = app.state::<VoiceState>();
    let path = state.model_path(&request.file)?;
    let expected = request.sha256.to_ascii_lowercase();
    if !MODEL_HOSTS.iter().any(|host| request.url.starts_with(host))
        || expected.len() != 64
        || !expected.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(CommandError::new(
            "invalid_input",
            "not a known model download",
        ));
    }
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err(CommandError::new(
            "speech_model_download_failed",
            "another model is downloading",
        ));
    }
    state.cancel_download.store(false, Ordering::SeqCst);
    let partial = path.with_extension("bin.part");
    let result = download(&app, &state, &request, &partial, &expected).await;
    state.downloading.store(false, Ordering::SeqCst);
    match result {
        Ok(()) => fs::rename(&partial, &path).map_err(|error| {
            let _ = fs::remove_file(&partial);
            failed(format!("couldn't save the model: {error}"))
        }),
        Err(error) => {
            let _ = fs::remove_file(&partial);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn voice_model_download_cancel(state: State<'_, VoiceState>) {
    state.cancel_download.store(true, Ordering::SeqCst);
}

fn failed(message: impl Into<String>) -> CommandError {
    CommandError::new("speech_model_download_failed", message)
}

async fn download<R: Runtime>(
    app: &AppHandle<R>,
    state: &VoiceState,
    request: &DownloadRequest,
    partial: &Path,
    expected: &str,
) -> CommandResult<()> {
    fs::create_dir_all(&state.models_dir).map_err(|e| failed(format!("models folder: {e}")))?;
    let mut response = reqwest::get(&request.url)
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| failed(format!("download: {e}")))?;
    let total = response.content_length().unwrap_or(request.size_bytes);
    let mut file = File::create(partial).map_err(|e| failed(format!("model file: {e}")))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = Instant::now();
    let progress = |received| DownloadProgress {
        id: request.id.clone(),
        received,
        total,
    };
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| failed(format!("download: {e}")))?
    {
        if state.cancel_download.load(Ordering::SeqCst) {
            return Err(CommandError::new("cancelled", "download cancelled"));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| failed(format!("model file: {e}")))?;
        received += chunk.len() as u64;
        if received > request.size_bytes.saturating_mul(2) {
            return Err(failed("the download is larger than expected"));
        }
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let _ = app.emit(EVENT_DOWNLOAD, progress(received));
            last_emit = Instant::now();
        }
    }
    file.flush()
        .and_then(|()| file.sync_all())
        .map_err(|e| failed(format!("model file: {e}")))?;
    let actual = to_hex(&hasher.finalize());
    if actual != expected {
        return Err(failed("the downloaded model didn't match its checksum"));
    }
    let _ = app.emit(EVENT_DOWNLOAD, progress(received));
    Ok(())
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_file_names_stay_in_the_folder() {
        assert!(valid_file_name("ggml-base.bin"));
        assert!(valid_file_name("ggml-small-q5_1.bin"));
        assert!(!valid_file_name("../avchetan.db"));
        assert!(!valid_file_name("..\\x.bin"));
        assert!(!valid_file_name("a/b.bin"));
        assert!(!valid_file_name("C:x.bin"));
        assert!(!valid_file_name(".bin"));
        assert!(!valid_file_name("model.exe"));
        assert!(!valid_file_name(""));
    }

    #[test]
    fn resamples_to_16k() {
        let one_second_48k = vec![0.5f32; 48_000];
        let out = to_whisper_rate(&one_second_48k, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));
        let ramp: Vec<f32> = (0..8).map(|i| i as f32).collect();
        assert_eq!(to_whisper_rate(&ramp, 32_000), vec![0.0, 2.0, 4.0, 6.0]);
        assert_eq!(to_whisper_rate(&ramp, 16_000), ramp);
        assert!(to_whisper_rate(&[], 44_100).is_empty());
    }

    #[test]
    fn meter_uses_decibels() {
        assert!(meter_level(0.0).abs() < f32::EPSILON);
        assert!(
            meter_level(0.000_004).abs() < f32::EPSILON,
            "near silence shows nothing"
        );
        assert!(
            (meter_level(0.001) - 0.0).abs() < 1e-5,
            "-60 dB is the floor"
        );
        assert!(
            (meter_level(0.01) - 0.4).abs() < 1e-5,
            "quiet speech moves it"
        );
        assert!((meter_level(1.0) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn downmixes_stereo() {
        assert_eq!(downmix(&[1.0f32, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25f32, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn drops_whisper_noise_tags() {
        assert_eq!(clean_transcript(" [BLANK_AUDIO] "), "");
        assert_eq!(clean_transcript(" आज gym  गया (music) "), "आज gym गया");
        assert_eq!(
            clean_transcript("ran 5k [ Laughter ] today"),
            "ran 5k today"
        );
    }

    /// 16-bit PCM mono WAV → samples and rate (test helper; the app never writes or reads WAV).
    fn read_wav(bytes: &[u8]) -> (Vec<f32>, u32) {
        let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let mut at = 12;
        while &bytes[at..at + 4] != b"data" {
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            at += 8 + size;
        }
        let samples = bytes[at + 8..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| f32::from(i16::from_le_bytes(*pair)) / 32768.0)
            .collect();
        (samples, rate)
    }

    /// Runs a real recording through Whisper. Needs a downloaded model, so it only runs by hand:
    /// `AVCHETAN_TEST_MODEL=<ggml-*.bin> AVCHETAN_TEST_WAV=<16-bit mono .wav>
    /// cargo test transcribes_a_recording -- --ignored --nocapture`
    #[test]
    #[ignore = "needs a speech model and a recording"]
    fn transcribes_a_recording() {
        let model = PathBuf::from(std::env::var("AVCHETAN_TEST_MODEL").unwrap());
        let wav = fs::read(std::env::var("AVCHETAN_TEST_WAV").unwrap()).unwrap();
        let language = std::env::var("AVCHETAN_TEST_LANGUAGE").ok();
        let (samples, rate) = read_wav(&wav);
        let audio = to_whisper_rate(&samples, rate);
        let shared = Mutex::new(Inner::default());
        let used = AtomicU64::new(0);
        let started = Instant::now();
        let text = transcribe(&shared, &used, &model, language.as_deref(), &audio).unwrap();
        println!(
            "{:.1} s of audio in {} ms: {text}",
            audio.len() as f32 / WHISPER_RATE as f32,
            started.elapsed().as_millis()
        );
        assert!(!text.is_empty());
        // The second run reuses the loaded model.
        assert!(shared.lock().unwrap().model.is_some());
    }

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(to_hex(&[0, 15, 255]), "000fff");
    }
}
