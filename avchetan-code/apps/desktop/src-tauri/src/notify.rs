//! Windows notifications (docs/product/daily-brief.md#reminders). Clicking one opens Days on
//! the brief's day. Texts are fixed here, so no entry text ever reaches the notification.

use tauri::{AppHandle, Runtime};
#[cfg(windows)]
use tauri_winrt_notification::Toast;

use crate::error::{CommandError, CommandResult};
use crate::windows::{self, is_local_date};

/// The app ID Windows shows the notification under. The installer gives the Start menu
/// shortcut the bundle identifier; a dev build has no shortcut, so it borrows PowerShell's.
#[cfg(windows)]
fn app_id<R: Runtime>(app: &AppHandle<R>) -> String {
    if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    }
}

#[tauri::command]
pub fn brief_notify(app: AppHandle, day: String) -> CommandResult<()> {
    if !is_local_date(&day) {
        return Err(CommandError::new("invalid_date", "Invalid date"));
    }
    show_brief_toast(&app, day)
}

#[cfg(windows)]
fn show_brief_toast<R: Runtime>(app: &AppHandle<R>, day: String) -> CommandResult<()> {
    let handle = app.clone();
    Toast::new(&app_id(app))
        .title("Your daily brief is ready")
        .text1("Open it in Avchetan")
        .on_activated(move |_| {
            crate::error::warn_on_err(
                "open brief",
                windows::open_main(&handle, "timeline", Some(&day)).map_err(|e| e.message),
            );
            Ok(())
        })
        .show()
        .map_err(|error| CommandError::new("notification_failed", error.to_string()))
}

#[cfg(not(windows))]
fn show_brief_toast<R: Runtime>(_app: &AppHandle<R>, _day: String) -> CommandResult<()> {
    // Windows only for now (macOS/Linux are unscheduled).
    let _ = windows::MAIN;
    Ok(())
}
