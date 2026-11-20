//! Windows notifications. The daily brief's (docs/product/daily-brief.md#reminders) opens Days
//! on its day and its texts are fixed here. A task reminder
//! (docs/product/tasks-routines-reminders.md §7) shows the task's title, or a fixed one for a
//! task from a private entry (decided in `packages/core`), and opens Tasks.

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

/// Whether a valid `YYYY-MM-DD` is a Sunday, when Sunday's brief also reviews the week
/// (docs/product/weekly-review.md). Sakamoto's method; Sunday is 0.
fn is_sunday(day: &str) -> bool {
    let part = |range: std::ops::Range<usize>| day[range].parse::<i64>().unwrap_or(0);
    let (mut year, month, date) = (part(0..4), part(5..7), part(8..10));
    const OFFSETS: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    if month < 3 {
        year -= 1;
    }
    let index = usize::try_from(month - 1).unwrap_or(0).min(11);
    (year + year / 4 - year / 100 + year / 400 + OFFSETS[index] + date) % 7 == 0
}

fn brief_title(day: &str) -> &'static str {
    if is_sunday(day) {
        "Your day and week in brief"
    } else {
        "Your daily brief is ready"
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
        .title(brief_title(&day))
        .text1("Open it in Avchetan")
        .on_activated(move |_| {
            crate::error::warn_on_err(
                "open brief",
                windows::open_main(&handle, "timeline", Some(&day), None).map_err(|e| e.message),
            );
            Ok(())
        })
        .show()
        .map_err(|error| CommandError::new("notification_failed", error.to_string()))
}

/// The longest reminder title shown; Windows cuts long ones anyway.
const MAX_REMINDER_TITLE: usize = 200;

fn reminder_title(title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    Some(title.chars().take(MAX_REMINDER_TITLE).collect())
}

#[tauri::command]
pub fn reminder_notify(app: AppHandle, title: String) -> CommandResult<()> {
    let title = reminder_title(&title)
        .ok_or_else(|| CommandError::new("invalid_title", "Title is empty"))?;
    show_reminder_toast(&app, title)
}

#[cfg(windows)]
fn show_reminder_toast<R: Runtime>(app: &AppHandle<R>, title: String) -> CommandResult<()> {
    let handle = app.clone();
    Toast::new(&app_id(app))
        .title(&title)
        .text1("Click to open it in Tasks")
        .on_activated(move |_| {
            crate::error::warn_on_err(
                "open tasks",
                windows::open_main(&handle, "tasks", None, None).map_err(|e| e.message),
            );
            Ok(())
        })
        .show()
        .map_err(|error| CommandError::new("notification_failed", error.to_string()))
}

#[cfg(not(windows))]
fn show_reminder_toast<R: Runtime>(_app: &AppHandle<R>, _title: String) -> CommandResult<()> {
    Ok(())
}

#[cfg(not(windows))]
fn show_brief_toast<R: Runtime>(_app: &AppHandle<R>, _day: String) -> CommandResult<()> {
    // Windows only for now (macOS/Linux are unscheduled).
    let _ = windows::MAIN;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sunday_briefs_mention_the_week() {
        assert!(is_sunday("2026-11-08"));
        assert!(is_sunday("2024-03-03"));
        assert!(!is_sunday("2026-11-09"));
        assert!(!is_sunday("2026-02-28"));
        assert_eq!(brief_title("2026-11-08"), "Your day and week in brief");
        assert_eq!(brief_title("2026-11-07"), "Your daily brief is ready");
    }

    #[test]
    fn reminder_titles_are_trimmed_and_cut() {
        assert_eq!(
            reminder_title("  Call the dentist "),
            Some("Call the dentist".into())
        );
        assert_eq!(reminder_title("   "), None);
        let long = "a".repeat(500);
        assert_eq!(
            reminder_title(&long).map(|t| t.len()),
            Some(MAX_REMINDER_TITLE)
        );
    }
}
