//! Secrets in the OS keychain (Windows Credential Manager). Values never reach logs,
//! error messages or disk in plaintext (CLAUDE.md rule 7).

use crate::error::{CommandError, CommandResult};

const SERVICE: &str = "app.avchetan";

fn store_failed(error: keyring::Error) -> CommandError {
    // keyring errors describe the platform failure, never the secret value.
    CommandError::new("secret_store_failed", error.to_string())
}

/// Names follow `area:scope:name` (packages/shared/src/adapters.ts).
fn entry(name: &str) -> CommandResult<keyring::Entry> {
    if name.is_empty() || name.len() > 200 || !name.contains(':') {
        return Err(CommandError::new(
            "secret_invalid_name",
            "Invalid secret name",
        ));
    }
    keyring::Entry::new(SERVICE, name).map_err(store_failed)
}

#[tauri::command(async)]
pub fn secret_get(name: String) -> CommandResult<Option<String>> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(store_failed(error)),
    }
}

#[tauri::command(async)]
pub fn secret_set(name: String, value: String) -> CommandResult<()> {
    entry(&name)?.set_password(&value).map_err(store_failed)
}

#[tauri::command(async)]
pub fn secret_delete(name: String) -> CommandResult<()> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(store_failed(error)),
    }
}
