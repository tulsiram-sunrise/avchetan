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
/// Left by an import until the hub has started with a new data epoch (sync-protocol.md).
const RESET_EPOCH_MARKER: &str = "reset-data-epoch";
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
                // The hub has its new data epoch by now (it's set before it listens).
                crate::error::warn_on_err(
                    "clear epoch marker",
                    remove_if_present(&self.dir.join(RESET_EPOCH_MARKER)),
                );
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
        import_data(source, &self.data_dir())?;
        self.mark_reset_epoch()
    }

    fn mark_reset_epoch(&self) -> CommandResult<()> {
        // Moved-in data may be older than what devices sent: they must send everything again.
        fs::write(self.dir.join(RESET_EPOCH_MARKER), "").map_err(io_failed("hub_import_failed"))
    }

    fn backups(&self) -> CommandResult<Vec<HubBackup>> {
        list_backups(&self.dir.join(BACKUP_FOLDER))
    }

    /// Puts a daily snapshot back. The current data is kept beside it, renamed, never deleted;
    /// if the restore fails, it goes back. The restored hub gets a new data epoch by itself.
    fn restore(&self, name: &str) -> CommandResult<()> {
        if !is_snapshot_name(name) {
            return Err(CommandError::new("hub_backup_invalid", "Not a hub backup"));
        }
        let snapshot = self.dir.join(BACKUP_FOLDER).join(name);
        if !snapshot.is_file() {
            return Err(CommandError::new(
                "hub_backup_invalid",
                "That backup is gone",
            ));
        }
        let program = program_path()?;
        let was_on = self.lock().config.enabled;
        self.stop();

        let data = self.data_dir();
        let aside = self
            .dir
            .join(format!("{DATA_FOLDER}-before-restore-{}", unix_seconds()));
        if data.exists() {
            fs::rename(&data, &aside).map_err(io_failed("hub_restore_failed"))?;
        }
        let output = hub_command(&program, &data)
            .env("RESTORE_SNAPSHOT", &snapshot)
            .stdin(Stdio::null())
            .output();
        let restored = matches!(&output, Ok(output) if output.status.success());
        if !restored {
            if let Ok(output) = &output {
                let mut inner = self.lock();
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    push_log(&mut inner.logs, line.to_string());
                }
            }
            crate::error::warn_on_err("undo restore", remove_dir_if_present(&data));
            if aside.exists() {
                crate::error::warn_on_err("undo restore", fs::rename(&aside, &data));
            }
        }
        if was_on {
            self.start(false);
        }
        if restored {
            Ok(())
        } else {
            Err(CommandError::new(
                "hub_restore_failed",
                "The backup couldn't be restored; the hub kept its data",
            ))
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubBackup {
    name: String,
    size_bytes: u64,
}

/// `hub-YYYY-MM-DD.tar.gz`, as the hub names its daily snapshots.
fn is_snapshot_name(name: &str) -> bool {
    let Some(date) = name
        .strip_prefix("hub-")
        .and_then(|rest| rest.strip_suffix(".tar.gz"))
    else {
        return false;
    };
    date.len() == 10
        && date.char_indices().all(|(index, c)| {
            if index == 4 || index == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        })
}

/// Newest first; a missing folder means no backups yet.
fn list_backups(dir: &Path) -> CommandResult<Vec<HubBackup>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_failed("hub_backup_failed")(error)),
    };
    let mut backups: Vec<HubBackup> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let size_bytes = entry.metadata().ok()?.len();
            is_snapshot_name(&name).then_some(HubBackup { name, size_bytes })
        })
        .collect();
    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn remove_dir_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
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

/// The hub program on a PGlite folder, with only the env vars Node needs from this app, and no
/// console window.
fn hub_command(program: &Path, data: &Path) -> Command {
    let mut command = Command::new(program);
    command.env_clear();
    for name in PASSED_ENV {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("DB_DRIVER", "pglite")
        .env("PGLITE_DATA_DIR", data);
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
}

fn spawn(dir: &Path, config: &HubConfig) -> CommandResult<Child> {
    let program = program_path()?;
    let token = secrets::read(TOKEN_SECRET)?
        .ok_or_else(|| CommandError::new("hub_token_missing", "The hub has no sync token yet"))?;
    let data = dir.join(DATA_FOLDER);
    let backups = dir.join(BACKUP_FOLDER);
    fs::create_dir_all(&backups).map_err(io_failed("hub_start_failed"))?;

    let mut command = hub_command(&program, &data);
    command
        .envs([
            ("SERVER_PROFILE", "hub"),
            ("BIND_HOST", "0.0.0.0"),
            ("SHUTDOWN_ON_STDIN_CLOSE", "true"),
            ("NODE_ENV", "production"),
        ])
        .env("PORT", config.port.to_string())
        .env("BACKUP_DIR", &backups)
        .env("SYNC_TOKEN", token);
    if dir.join(RESET_EPOCH_MARKER).is_file() {
        command.env("RESET_DATA_EPOCH", "true");
    }
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

#[tauri::command(async)]
pub fn hub_backup_list(state: State<'_, HubState>) -> CommandResult<Vec<HubBackup>> {
    state.backups()
}

#[tauri::command(async)]
pub fn hub_restore(state: State<'_, HubState>, name: String) -> CommandResult<HubStatus> {
    state.restore(&name)?;
    Ok(state.status())
}

/// The first port from `from` up that nothing listens on, for **Use another port** (feature
/// audit bug 7). It binds the way the hub does, on every address.
#[tauri::command]
pub fn hub_free_port(from: u16) -> CommandResult<u16> {
    free_port(from, |port| {
        std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
    })
    .ok_or_else(|| CommandError::new("hub_port_in_use", "No free port near this one"))
}

fn free_port(from: u16, is_free: impl Fn(u16) -> bool) -> Option<u16> {
    let start = from.max(1024);
    (start..=start.saturating_add(100)).find(|&port| is_free(port))
}

/// `data` or `backups`, in the system file manager.
#[tauri::command]
pub fn hub_folder_open(
    app: tauri::AppHandle,
    state: State<'_, HubState>,
    folder: String,
) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let path = match folder.as_str() {
        "data" => state.dir.clone(),
        "backups" => state.dir.join(BACKUP_FOLDER),
        _ => return Err(CommandError::new("open_failed", "Unknown folder")),
    };
    fs::create_dir_all(&path).map_err(io_failed("open_failed"))?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| CommandError::new("open_failed", error.to_string()))
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
    fn asks_for_a_new_data_epoch_after_moving_data_in() {
        let dir = temp_dir("epoch");
        fake_hub_data(&dir.join("old"));
        let state = HubState::load(dir.join("hub"));
        state.import(&dir.join("old")).unwrap();
        assert!(dir.join("hub").join(RESET_EPOCH_MARKER).is_file());
        remove_if_present(&dir.join("hub").join(RESET_EPOCH_MARKER)).unwrap();
        remove_if_present(&dir.join("hub").join(RESET_EPOCH_MARKER)).unwrap();
    }

    #[test]
    fn lists_only_dated_hub_backups_newest_first() {
        let dir = temp_dir("backups");
        for name in [
            "hub-2026-11-02.tar.gz",
            "hub-2026-11-04.tar.gz",
            "notes.txt",
            "hub-x.tar.gz",
        ] {
            fs::write(dir.join(name), "x").unwrap();
        }
        let names: Vec<String> = list_backups(&dir)
            .unwrap()
            .into_iter()
            .map(|b| b.name)
            .collect();
        assert_eq!(names, ["hub-2026-11-04.tar.gz", "hub-2026-11-02.tar.gz"]);
        assert!(list_backups(&dir.join("missing")).unwrap().is_empty());
        assert!(!is_snapshot_name("../hub-2026-11-04.tar.gz"));
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
    fn finds_the_next_free_port() {
        assert_eq!(free_port(8787, |port| port > 8789), Some(8790));
        assert_eq!(free_port(80, |_| true), Some(1024));
        assert_eq!(free_port(8787, |_| false), None);
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
