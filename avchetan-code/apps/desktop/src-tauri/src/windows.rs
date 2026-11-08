//! Dock and main window behaviour (docs/architecture/desktop.md#windows).

use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use serde::Serialize;

use crate::app_lock::{self, LockState};
use crate::clipboard::{self, ClipboardRead};
use crate::context::{self, WindowContext};
use crate::error::{warn_on_err, CommandError, CommandResult};

pub const DOCK: &str = "dock";
pub const MAIN: &str = "main";

/// Hide the dock this long after it loses focus, unless it got focus back (tray clicks).
const BLUR_HIDE_DELAY: Duration = Duration::from_millis(100);

/// Tray: show the dock, or hide it if it is already in front. No window context: the window in
/// front is the taskbar.
pub fn toggle_dock<R: Runtime>(app: &AppHandle<R>) {
    toggle(app, false);
}

/// The dock is showing and in front: a hotkey press would hide it.
pub fn dock_is_open<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(DOCK).is_some_and(|dock| {
        dock.is_visible().unwrap_or(false) && dock.is_focused().unwrap_or(false)
    })
}

pub fn hide_dock<R: Runtime>(app: &AppHandle<R>) {
    if let Some(dock) = app.get_webview_window(DOCK) {
        warn_on_err("hide dock", dock.hide());
        // Every place the dock hides tells the app lock, which counts time away from it.
        app_lock::dock_hidden(app);
    }
}

/// Hotkey: as the tray, and notes the window that was in front before the dock takes focus.
pub fn toggle_dock_from_hotkey<R: Runtime>(app: &AppHandle<R>) {
    toggle(app, true);
}

fn toggle<R: Runtime>(app: &AppHandle<R>, with_context: bool) {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return;
    };
    let visible = dock.is_visible().unwrap_or(false);
    let focused = dock.is_focused().unwrap_or(false);
    if visible && focused {
        warn_on_err("hide dock", dock.hide());
        app_lock::dock_hidden(app);
    } else {
        let context = if with_context {
            context::previous_window_context()
        } else {
            None
        };
        show(app, DockShown::new(context));
    }
}

/// Clipboard snap: shows the dock with the clipboard's text, read now. Never hides it: pressed
/// while the dock is open, the clipboard is attached to what is being typed
/// (docs/product/clipboard-snap.md).
pub fn show_dock_with_clipboard<R: Runtime>(app: &AppHandle<R>) {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return;
    };
    let already_open = dock.is_visible().unwrap_or(false) && dock.is_focused().unwrap_or(false);
    // The window first, while it is still in front; then the clipboard.
    let context = if already_open {
        None
    } else {
        context::previous_window_context()
    };
    show(
        app,
        DockShown {
            context,
            clipboard: Some(clipboard::read_clipboard_text()),
            already_open,
        },
    );
}

#[derive(Clone, Serialize)]
struct DockShown {
    context: Option<WindowContext>,
    /// Only from the clipboard shortcut.
    clipboard: Option<ClipboardRead>,
    /// The dock was already in front: keep its window context and what is typed.
    already_open: bool,
}

impl DockShown {
    fn new(context: Option<WindowContext>) -> Self {
        Self {
            context,
            clipboard: None,
            already_open: false,
        }
    }
}

pub fn show_dock<R: Runtime>(app: &AppHandle<R>) {
    show(app, DockShown::new(None));
}

fn show<R: Runtime>(app: &AppHandle<R>, shown: DockShown) {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return;
    };
    // Position before showing so it never flashes on the wrong monitor.
    if !dock.is_visible().unwrap_or(false) {
        warn_on_err("position dock", center_on_cursor_monitor(app, &dock));
    }
    warn_on_err("show dock", dock.show());
    warn_on_err("focus dock", dock.set_focus());
    warn_on_err("emit dock:shown", app.emit_to(DOCK, "dock:shown", shown));
}

/// Centered horizontally, in the upper third of the work area of the monitor the cursor is on.
fn center_on_cursor_monitor<R: Runtime>(
    app: &AppHandle<R>,
    dock: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let cursor = app.cursor_position()?;
    let monitor = match app.monitor_from_point(cursor.x, cursor.y)? {
        Some(monitor) => Some(monitor),
        None => dock.primary_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = dock.outer_size()?;
    let free_width = i64::from(area.size.width) - i64::from(size.width);
    let free_height = i64::from(area.size.height) - i64::from(size.height);
    let x = i64::from(area.position.x) + free_width / 2;
    let y = i64::from(area.position.y) + free_height / 3;
    dock.set_position(PhysicalPosition::new(
        i32::try_from(x).unwrap_or(area.position.x),
        i32::try_from(y).unwrap_or(area.position.y),
    ))
}

/// A local date, `YYYY-MM-DD`: only digits and dashes, so safe to put into a script.
pub fn is_local_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

/// Shows the main window, creating it on first use. `view` is `timeline`, `settings` or `setup`;
/// `day` (`YYYY-MM-DD`) opens that day in Days.
pub fn open_main<R: Runtime>(
    app: &AppHandle<R>,
    view: &str,
    day: Option<&str>,
) -> CommandResult<()> {
    if !matches!(view, "timeline" | "settings" | "setup") {
        return Err(CommandError::new("invalid_view", "Unknown view"));
    }
    if day.is_some_and(|day| !is_local_date(day)) {
        return Err(CommandError::new("invalid_date", "Invalid date"));
    }
    // Before showing, so a window left longer than the lock time never shows its pages again.
    app_lock::mark_back(app);
    if let Some(main) = app.get_webview_window(MAIN) {
        warn_on_err("unminimize main", main.unminimize());
        warn_on_err("show main", main.show());
        warn_on_err("focus main", main.set_focus());
        warn_on_err(
            "emit main:navigate",
            app.emit_to(
                MAIN,
                "main:navigate",
                serde_json::json!({ "view": view, "day": day }),
            ),
        );
        return Ok(());
    }
    // `view` is one of three literals and `day` only digits and dashes (checked above), so both
    // are safe to inline.
    let mut script = format!("window.__AVCHETAN_INITIAL_VIEW__ = '{view}';");
    if let Some(day) = day {
        script.push_str(&format!("window.__AVCHETAN_INITIAL_DAY__ = '{day}';"));
    }
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("main.html".into()))
        .title("Avchetan")
        .inner_size(1000.0, 700.0)
        .min_inner_size(640.0, 480.0)
        .initialization_script(&script)
        .build()
        .map(|_| ())
        .map_err(|error| CommandError::new("window_failed", error.to_string()))
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match (window.label(), event) {
        // Neither window is ever destroyed: the dock's webview runs background work, and
        // reopening the main window should be instant.
        (DOCK | MAIN, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            warn_on_err("hide on close", window.hide());
            if window.label() == MAIN {
                app_lock::mark_away(window.app_handle());
            } else {
                app_lock::dock_hidden(window.app_handle());
            }
        }
        // The app lock counts time away from when the main window is hidden or minimized.
        (MAIN, WindowEvent::Resized(_)) => {
            if window.is_minimized().unwrap_or(false) {
                app_lock::mark_away(window.app_handle());
            }
        }
        (MAIN, WindowEvent::Focused(true)) => app_lock::mark_back(window.app_handle()),
        (DOCK, WindowEvent::Focused(false)) => {
            // Windows Hello takes focus from the dock; the dock stays until it is done.
            if window.state::<LockState>().is_prompting() {
                return;
            }
            let dock = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(BLUR_HIDE_DELAY);
                if !dock.is_focused().unwrap_or(false) {
                    warn_on_err("hide dock on blur", dock.hide());
                    app_lock::dock_hidden(dock.app_handle());
                }
            });
        }
        _ => {}
    }
}

#[tauri::command]
pub fn dock_hide(app: AppHandle) -> CommandResult<()> {
    if let Some(dock) = app.get_webview_window(DOCK) {
        dock.hide()
            .map_err(|error| CommandError::new("window_failed", error.to_string()))?;
        app_lock::dock_hidden(&app);
    }
    Ok(())
}

/// `async` because creating a window from a synchronous command deadlocks on Windows.
#[tauri::command(async)]
pub fn main_open(app: AppHandle, view: String, day: Option<String>) -> CommandResult<()> {
    open_main(&app, &view, day.as_deref())
}

#[cfg(test)]
mod tests {
    use super::is_local_date;

    #[test]
    fn local_dates_are_only_digits_and_dashes() {
        assert!(is_local_date("2026-11-06"));
        assert!(!is_local_date("2026-11-6"));
        assert!(!is_local_date("2026-11-06'"));
        assert!(!is_local_date("2026/11/06"));
        assert!(!is_local_date("x';alert(1)"));
    }
}
