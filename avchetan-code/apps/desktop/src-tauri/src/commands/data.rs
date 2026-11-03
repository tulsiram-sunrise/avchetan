//! Backups and exports on disk (docs/product/advancements.md §8). The webview decides
//! when to back up and what to export; these commands only touch files.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::commands::db::DbState;
use crate::error::{CommandError, CommandResult};

const BACKUP_PREFIX: &str = "avchetan-";
const BACKUP_SUFFIX: &str = ".db";
const EXPORTS_FOLDER: &str = "Avchetan exports";

fn io_failed(code: &'static str) -> impl Fn(std::io::Error) -> CommandError {
    move |error| CommandError::new(code, error.to_string())
}

fn backups_dir(state: &DbState) -> PathBuf {
    state
        .path()
        .parent()
        .map_or_else(|| PathBuf::from("backups"), |dir| dir.join("backups"))
}

/// `avchetan-YYYY-MM-DD.db`: dated names sort by age and can't escape the folder.
fn is_backup_name(name: &str) -> bool {
    let Some(date) = name
        .strip_prefix(BACKUP_PREFIX)
        .and_then(|rest| rest.strip_suffix(BACKUP_SUFFIX))
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

/// A plain file or folder name: no separators, no `..`, nothing Windows reserves.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    name: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupList {
    folder: String,
    /// Newest first.
    files: Vec<BackupFile>,
}

fn list_backups(dir: &Path) -> CommandResult<Vec<BackupFile>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_failed("backup_failed")(error)),
    };
    let mut files: Vec<BackupFile> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let size_bytes = entry.metadata().ok()?.len();
            is_backup_name(&name).then_some(BackupFile { name, size_bytes })
        })
        .collect();
    files.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(files)
}

#[tauri::command(async)]
pub fn backup_list(state: State<'_, DbState>) -> CommandResult<BackupList> {
    let dir = backups_dir(&state);
    Ok(BackupList {
        folder: dir.display().to_string(),
        files: list_backups(&dir)?,
    })
}

/// Copies the database to `name` (unless that file exists and `replace` is false), then
/// keeps only the newest `keep` backups. `VACUUM INTO` on its own connection gives a
/// consistent copy while the windows keep using theirs; the rename makes it appear whole.
#[tauri::command(async)]
pub fn backup_create(
    state: State<'_, DbState>,
    name: String,
    keep: usize,
    replace: bool,
) -> CommandResult<BackupList> {
    if !is_backup_name(&name) || keep == 0 {
        return Err(CommandError::new("backup_invalid", "Invalid backup name"));
    }
    let dir = backups_dir(&state);
    fs::create_dir_all(&dir).map_err(io_failed("backup_failed"))?;
    let target = dir.join(&name);
    if replace || !target.exists() {
        let partial = dir.join(format!("{name}.partial"));
        if partial.exists() {
            fs::remove_file(&partial).map_err(io_failed("backup_failed"))?;
        }
        let connection = Connection::open(state.path())
            .map_err(|error| CommandError::new("backup_failed", error.to_string()))?;
        connection
            .execute("VACUUM INTO ?1", [partial.display().to_string()])
            .map_err(|error| CommandError::new("backup_failed", error.to_string()))?;
        drop(connection);
        fs::rename(&partial, &target).map_err(io_failed("backup_failed"))?;
    }
    let files = list_backups(&dir)?;
    for old in files.iter().skip(keep) {
        fs::remove_file(dir.join(&old.name)).map_err(io_failed("backup_failed"))?;
    }
    Ok(BackupList {
        folder: dir.display().to_string(),
        files: files.into_iter().take(keep).collect(),
    })
}

#[derive(Deserialize)]
pub struct ExportFile {
    name: String,
    content: String,
}

#[derive(Serialize)]
pub struct ExportResult {
    folder: String,
}

/// Writes the export into `Documents/Avchetan exports/<folder>/` and returns that folder.
#[tauri::command(async)]
pub fn export_write(
    app: AppHandle,
    folder: String,
    files: Vec<ExportFile>,
) -> CommandResult<ExportResult> {
    if !is_plain_name(&folder) || files.iter().any(|file| !is_plain_name(&file.name)) {
        return Err(CommandError::new(
            "export_invalid",
            "Invalid export file name",
        ));
    }
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| CommandError::new("export_failed", error.to_string()))?;
    let dir = documents.join(EXPORTS_FOLDER).join(&folder);
    fs::create_dir_all(&dir).map_err(io_failed("export_failed"))?;
    for file in files {
        fs::write(dir.join(&file.name), file.content).map_err(io_failed("export_failed"))?;
    }
    Ok(ExportResult {
        folder: dir.display().to_string(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataFolder {
    Backups,
    Exports,
}

/// Opens the backups or exports folder in the file manager.
#[tauri::command(async)]
pub fn data_folder_open(
    app: AppHandle,
    state: State<'_, DbState>,
    folder: DataFolder,
) -> CommandResult<()> {
    let dir = match folder {
        DataFolder::Backups => backups_dir(&state),
        DataFolder::Exports => app
            .path()
            .document_dir()
            .map_err(|error| CommandError::new("open_failed", error.to_string()))?
            .join(EXPORTS_FOLDER),
    };
    fs::create_dir_all(&dir).map_err(io_failed("open_failed"))?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|error| CommandError::new("open_failed", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_dated_backup_names() {
        assert!(is_backup_name("avchetan-2026-11-03.db"));
        assert!(!is_backup_name("avchetan-2026-11-3.db"));
        assert!(!is_backup_name("avchetan-../../x.db"));
        assert!(!is_backup_name("avchetan.db"));
    }

    #[test]
    fn accepts_only_plain_names() {
        assert!(is_plain_name("avchetan-export-2026-11-03-140311"));
        assert!(is_plain_name("raw_logs.csv"));
        assert!(!is_plain_name(".."));
        assert!(!is_plain_name("a/b.csv"));
        assert!(!is_plain_name("a\\b.csv"));
        assert!(!is_plain_name("c:"));
    }
}
