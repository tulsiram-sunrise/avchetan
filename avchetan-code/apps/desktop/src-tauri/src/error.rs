use serde::Serialize;

/// What every command returns on failure. The TS side (src/native/ipc.ts) turns it into a
/// `NativeError` with the same `code`. Messages never contain user content or secrets.
#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

/// Logs a failed native call that has no caller to report to (window and tray plumbing).
pub fn warn_on_err<T, E: std::fmt::Display>(context: &str, result: Result<T, E>) {
    if let Err(error) = result {
        eprintln!("[avchetan] {context}: {error}");
    }
}
