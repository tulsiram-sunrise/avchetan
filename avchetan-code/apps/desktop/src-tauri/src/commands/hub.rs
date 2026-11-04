//! The built-in Home Hub (ADR-0024): runs the server program as a child process, restarts it
//! after a crash, and stops it by closing its stdin. The webview decides what the hub should
//! do (hub.json); this module only keeps the process in that state.

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::secrets;
use crate::error::{CommandError, CommandResult};

/// The keychain entry holding the hub's sync token. The desktop app's own copy is `sync:token`.
pub const TOKEN_SECRET: &str = "hub:server:token";
const CONFIG_FILE: &str = "hub.json";
const DATA_FOLDER: &str = "pglite-data";
const BACKUP_FOLDER: &str = "backups";
const LOG_LINES: usize = 200;
const STOP_WAIT: Duration = Duration::from_secs(10);
const WATCH_EVERY: Duration = Duration::from_millis(300);
/// A crash this soon after starting counts towards giving up.
const QUICK_CRASH: Duration = Duration::from_secs(60);
const MAX_QUICK_CRASHES: u32 = 5;
const PROVIDERS: [&str; 3] = ["groq", "google", "ollama"];
/// Passed through to the hub so Node runs normally; nothing else from the app's environment is.
const PASSED_ENV: [&str; 12] = [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "COMPUTERNAME",
    "HOME",
    "LANG",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSlot {
    provider: String,
    model: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubConfig {
    enabled: bool,
    port: u16,
    extraction: Option<ModelSlot>,
    analysis: Option<ModelSlot>,
    embedding: Option<ModelSlot>,
}

impl Default for HubConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8787,
            extraction: None,
            analysis: None,
            embedding: None,
        }
    }
}

impl HubConfig {
    fn validate(&self) -> CommandResult<()> {
        if self.port < 1024 {
            return Err(CommandError::new(
                "hub_invalid_config",
                "Port must be 1024 or higher",
            ));
        }
        for slot in [&self.extraction, &self.analysis, &self.embedding]
            .into_iter()
            .flatten()
        {
            let model_ok = !slot.model.is_empty()
                && slot.model.len() <= 200
                && !slot.model.chars().any(char::is_control);
            if !PROVIDERS.contains(&slot.provider.as_str()) || !model_ok {
                return Err(CommandError::new(
                    "hub_invalid_config",
                    "Unknown model setting",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Off,
    Starting,
    Running,
    Restarting,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubStatus {
    phase: Phase,
    config: HubConfig,
    data_folder: String,
    has_data: bool,
    restarts: u32,
    /// Why it stopped trying: `hub_port_in_use`, `hub_crashed`, `hub_program_missing`, …
    error: Option<&'static str>,
    /// The hub's recent log lines, which hold IDs, counts and durations, never entries.
    logs: Vec<String>,
}

struct Inner {
    config: HubConfig,
    phase: Phase,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// Bumped on every start and stop, so threads of an older process leave it alone.
    generation: u64,
    started_at: Option<Instant>,
    restarts: u32,
    quick_crashes: u32,
    error: Option<&'static str>,
    logs: VecDeque<String>,
}

#[derive(Clone)]
pub struct HubState {
    dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
}

impl HubState {
    /// `dir` is `<app data>/hub`. A missing or unreadable hub.json means the hub is off.
    pub fn load(dir: PathBuf) -> Self {
        let config = fs::read_to_string(dir.join(CONFIG_FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<HubConfig>(&text).ok())
            .filter(|config| config.validate().is_ok())
            .unwrap_or_default();
        Self {
            dir,
            inner: Arc::new(Mutex::new(Inner {
                config,
                phase: Phase::Off,
                child: None,
                stdin: None,
                generation: 0,
                started_at: None,
                restarts: 0,
                quick_crashes: 0,
                error: None,
                logs: VecDeque::new(),
            })),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves plain data behind; keep using it.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn data_dir(&self) -> PathBuf {
        self.dir.join(DATA_FOLDER)
    }

    /// At app start: run the hub if it was left on.
    pub fn start_if_enabled(&self) {
        if self.lock().config.enabled {
            self.start(false);
        }
    }

    fn status(&self) -> HubStatus {
        let inner = self.lock();
        HubStatus {
            phase: inner.phase,
            config: inner.config.clone(),
            data_folder: self.data_dir().to_string_lossy().into_owned(),
            has_data: has_entries(&self.data_dir()),
            restarts: inner.restarts,
            error: inner.error,
            logs: inner.logs.iter().cloned().collect(),
        }
    }

    fn start(&self, restarting: bool) {
        let mut inner = self.lock();
        inner.generation += 1;
        let generation = inner.generation;
        if !restarting {
            inner.restarts = 0;
            inner.quick_crashes = 0;
        }
        inner.error = None;
        inner.phase = Phase::Starting;
        match spawn(&self.dir, &inner.config) {
            Ok(mut child) => {
                inner.stdin = child.stdin.take();
                for stream in [
                    child
                        .stdout
                        .take()
                        .map(|s| Box::new(s) as Box<dyn Read + Send>),
                    child
                        .stderr
                        .take()
                        .map(|s| Box::new(s) as Box<dyn Read + Send>),
                ]
                .into_iter()
                .flatten()
                {
                    let state = self.clone();
                    thread::spawn(move || state.read_logs(stream, generation));
                }
                inner.child = Some(child);
                inner.started_at = Some(Instant::now());
                let state = self.clone();
                thread::spawn(move || state.watch(generation));
            }
            Err(error) => {
                inner.phase = Phase::Failed;
                inner.error = Some(error.code);
                push_log(&mut inner.logs, format!("[desktop] {}", error.message));
            }
        }
    }

    fn read_logs(&self, stream: Box<dyn Read + Send>, generation: u64) {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            let mut inner = self.lock();
            if inner.generation != generation {
                break;
            }
            if line.starts_with("[server] listening") && inner.phase == Phase::Starting {
                inner.phase = Phase::Running;
            }
            push_log(&mut inner.logs, line);
        }
    }

    /// Notices the process ending and starts it again, waiting longer after each quick crash.
    fn watch(&self, generation: u64) {
        loop {
            thread::sleep(WATCH_EVERY);
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            let exited = match inner.child.as_mut().map(Child::try_wait) {
                Some(Ok(None)) => continue,
                Some(Ok(Some(status))) => status.code(),
                Some(Err(_)) | None => None,
            };
            inner.child = None;
            inner.stdin = None;
            let quick = inner
                .started_at
                .is_some_and(|started| started.elapsed() < QUICK_CRASH);
            inner.quick_crashes = if quick { inner.quick_crashes + 1 } else { 1 };
            let code = exited.map_or_else(|| "none".to_string(), |code| code.to_string());
            push_log(
                &mut inner.logs,
                format!("[desktop] hub stopped (exit code {code})"),
            );
            if inner.quick_crashes >= MAX_QUICK_CRASHES {
                inner.phase = Phase::Failed;
                inner.error = Some(failure_code(&inner.logs));
                return;
            }
            inner.phase = Phase::Restarting;
            inner.restarts += 1;
            let wait = Duration::from_secs(1 << inner.quick_crashes.min(5));
            drop(inner);
            thread::sleep(wait);
            if self.lock().generation != generation {
                return;
            }
            self.start(true);
            return;
        }
    }

    /// Closes the hub's stdin so it shuts down cleanly, then waits; kills it only if it hangs.
    pub fn stop(&self) {
        let (child, stdin) = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.phase = Phase::Off;
            (inner.child.take(), inner.stdin.take())
        };
        drop(stdin);
        let Some(mut child) = child else { return };
        let deadline = Instant::now() + STOP_WAIT;
        while Instant::now() < deadline {
            if !matches!(child.try_wait(), Ok(None)) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        crate::error::warn_on_err("stop hub", child.kill());
        crate::error::warn_on_err("stop hub", child.wait());
    }

    fn configure(&self, config: HubConfig) -> CommandResult<()> {
        config.validate()?;
        fs::create_dir_all(&self.dir).map_err(io_failed("hub_config_failed"))?;
        let text = serde_json::to_string_pretty(&config)
            .map_err(|error| CommandError::new("hub_config_failed", error.to_string()))?;
        fs::write(self.dir.join(CONFIG_FILE), text).map_err(io_failed("hub_config_failed"))?;
        self.stop();
        let enabled = config.enabled;
        self.lock().config = config;
        if enabled {
            self.start(false);
        }
        Ok(())
    }

    fn import(&self, source: &Path) -> CommandResult<()> {
        if self.lock().phase != Phase::Off {
            return Err(CommandError::new(
                "hub_running",
                "Turn the hub off before using other hub data",
            ));
        }
        import_data(source, &self.data_dir())
    }
}

fn io_failed(code: &'static str) -> impl Fn(std::io::Error) -> CommandError {
    move |error| CommandError::new(code, error.to_string())
}

fn push_log(logs: &mut VecDeque<String>, line: String) {
    if logs.len() == LOG_LINES {
        logs.pop_front();
    }
    logs.push_back(line);
}

fn failure_code(logs: &VecDeque<String>) -> &'static str {
    if logs.iter().any(|line| line.contains("EADDRINUSE")) {
        "hub_port_in_use"
    } else {
        "hub_crashed"
    }
}

/// A PGlite data folder always holds `PG_VERSION`.
fn has_entries(dir: &Path) -> bool {
    dir.join("PG_VERSION").is_file()
}

/// The hub program: beside the app once installed, or where `build:sidecar` puts it in a
/// development build.
fn program_path() -> CommandResult<PathBuf> {
    let name = if cfg!(windows) {
        "avchetan-hub.exe"
    } else {
        "avchetan-hub"
    };
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        candidates.push(dir.join(name));
    }
    if cfg!(debug_assertions) {
        let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../server/dist/sidecar");
        if let Ok(entries) = fs::read_dir(&built) {
            candidates.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("avchetan-hub-"))
            }));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            CommandError::new(
                "hub_program_missing",
                "The hub program isn't installed with this copy of Avchetan",
            )
        })
}

fn spawn(dir: &Path, config: &HubConfig) -> CommandResult<Child> {
    let program = program_path()?;
    let token = secrets::read(TOKEN_SECRET)?
        .ok_or_else(|| CommandError::new("hub_token_missing", "The hub has no sync token yet"))?;
    let data = dir.join(DATA_FOLDER);
    let backups = dir.join(BACKUP_FOLDER);
    fs::create_dir_all(&backups).map_err(io_failed("hub_start_failed"))?;

    let mut command = Command::new(&program);
    command.env_clear();
    for name in PASSED_ENV {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .envs([
            ("DB_DRIVER", "pglite"),
            ("SERVER_PROFILE", "hub"),
            ("BIND_HOST", "0.0.0.0"),
            ("SHUTDOWN_ON_STDIN_CLOSE", "true"),
            ("NODE_ENV", "production"),
        ])
        .env("PORT", config.port.to_string())
        .env("PGLITE_DATA_DIR", &data)
        .env("BACKUP_DIR", &backups)
        .env("SYNC_TOKEN", token);
    let slots = [
        ("EXTRACTION", &config.extraction),
        ("ANALYSIS", &config.analysis),
        ("EMBEDDING", &config.embedding),
    ];
    for (prefix, slot) in slots {
        let Some(slot) = slot else { continue };
        command
            .env(format!("{prefix}_PROVIDER"), &slot.provider)
            .env(format!("{prefix}_MODEL"), &slot.model);
        if slot.provider != "ollama" {
            if let Some(key) = secrets::read(&format!("provider:{}:apiKey", slot.provider))? {
                command.env(format!("{}_API_KEY", slot.provider.to_uppercase()), key);
            }
        }
    }
    if let Some(dir) = program.parent() {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(io_failed("hub_start_failed"))
}

/// Copies a hub's PGlite folder (from `start:hub` or a backup) into an empty data folder.
fn import_data(source: &Path, target: &Path) -> CommandResult<()> {
    if !has_entries(source) {
        return Err(CommandError::new(
            "hub_import_not_hub_data",
            "That folder doesn't hold hub data. Choose the pglite-data folder",
        ));
    }
    if has_entries(target) {
        return Err(CommandError::new(
            "hub_import_target_not_empty",
            "The built-in hub already has data",
        ));
    }
    let partial = target.with_extension("importing");
    if partial.exists() {
        fs::remove_dir_all(&partial).map_err(io_failed("hub_import_failed"))?;
    }
    copy_dir(source, &partial).map_err(io_failed("hub_import_failed"))?;
    // A half-copied folder never looks like hub data: it's renamed into place at the end.
    if target.exists() {
        fs::remove_dir(target).map_err(io_failed("hub_import_target_not_empty"))?;
    }
    fs::rename(&partial, target).map_err(io_failed("hub_import_failed"))
}

fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let to = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn hub_status(state: State<'_, HubState>) -> HubStatus {
    state.status()
}

#[tauri::command(async)]
pub fn hub_configure(state: State<'_, HubState>, config: HubConfig) -> CommandResult<HubStatus> {
    state.configure(config)?;
    Ok(state.status())
}

#[tauri::command(async)]
pub fn hub_import_data(state: State<'_, HubState>, source: String) -> CommandResult<HubStatus> {
    state.import(Path::new(&source))?;
    Ok(state.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("avchetan-hub-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_hub_data(dir: &Path) {
        fs::create_dir_all(dir.join("base/1")).unwrap();
        fs::write(dir.join("PG_VERSION"), "17").unwrap();
        fs::write(dir.join("base/1/table"), "rows").unwrap();
    }

    #[test]
    fn imports_hub_data_into_an_empty_folder() {
        let dir = temp_dir("import");
        fake_hub_data(&dir.join("old"));
        let target = dir.join("hub/pglite-data");
        fs::create_dir_all(&target).unwrap();
        import_data(&dir.join("old"), &target).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("base/1/table")).unwrap(),
            "rows"
        );
        assert!(!dir.join("hub/pglite-data.importing").exists());
    }

    #[test]
    fn refuses_a_folder_without_hub_data_or_a_target_with_data() {
        let dir = temp_dir("refuse");
        fs::create_dir_all(dir.join("documents")).unwrap();
        let error = import_data(&dir.join("documents"), &dir.join("target")).unwrap_err();
        assert_eq!(error.code, "hub_import_not_hub_data");

        fake_hub_data(&dir.join("old"));
        fake_hub_data(&dir.join("target"));
        let error = import_data(&dir.join("old"), &dir.join("target")).unwrap_err();
        assert_eq!(error.code, "hub_import_target_not_empty");
    }

    #[test]
    fn checks_the_config() {
        let mut config = HubConfig::default();
        assert!(config.validate().is_ok());
        config.extraction = Some(ModelSlot {
            provider: "ollama".into(),
            model: "granite4.2:3b".into(),
        });
        assert!(config.validate().is_ok());
        config.extraction = Some(ModelSlot {
            provider: "openai".into(),
            model: "x".into(),
        });
        assert_eq!(config.validate().unwrap_err().code, "hub_invalid_config");
        config.extraction = None;
        config.port = 80;
        assert_eq!(config.validate().unwrap_err().code, "hub_invalid_config");
    }

    #[test]
    fn names_a_port_already_in_use() {
        let mut logs = VecDeque::new();
        push_log(
            &mut logs,
            "[server] startup failed { error: 'listen EADDRINUSE: address already in use' }".into(),
        );
        assert_eq!(failure_code(&logs), "hub_port_in_use");
        assert_eq!(failure_code(&VecDeque::new()), "hub_crashed");
    }

    #[test]
    fn keeps_only_the_latest_log_lines() {
        let mut logs = VecDeque::new();
        for n in 0..(LOG_LINES + 5) {
            push_log(&mut logs, n.to_string());
        }
        assert_eq!(logs.len(), LOG_LINES);
        assert_eq!(logs.front().map(String::as_str), Some("5"));
    }
}
