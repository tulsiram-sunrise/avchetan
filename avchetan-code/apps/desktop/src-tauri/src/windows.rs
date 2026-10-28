//! Dock and main window behaviour (docs/architecture/desktop.md#windows).

use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::error::{warn_on_err, CommandError, CommandResult};

pub const DOCK: &str = "dock";
pub const MAIN: &str = "main";

/// Hide the dock this long after it loses focus, unless it got focus back (tray clicks).
const BLUR_HIDE_DELAY: Duration = Duration::from_millis(100);

/// Hotkey and tray: show the dock, or hide it if it is already in front.
pub fn toggle_dock<R: Runtime>(app: &AppHandle<R>) {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return;
    };
    let visible = dock.is_visible().unwrap_or(false);
    let focused = dock.is_focused().unwrap_or(false);
    if visible && focused {
        warn_on_err("hide dock", dock.hide());
    } else {
        show_dock(app);
    }
}

pub fn show_dock<R: Runtime>(app: &AppHandle<R>) {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return;
    };
    // Position before showing so it never flashes on the wrong monitor.
    if !dock.is_visible().unwrap_or(false) {
        warn_on_err("position dock", center_on_cursor_monitor(app, &dock));
    }
    warn_on_err("show dock", dock.show());
    warn_on_err("focus dock", dock.set_focus());
    warn_on_err("emit dock:shown", app.emit_to(DOCK, "dock:shown", ()));
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

/// Shows the main window, creating it on first use. `view` is `timeline` or `settings`.
pub fn open_main<R: Runtime>(app: &AppHandle<R>, view: &str) -> CommandResult<()> {
    if !matches!(view, "timeline" | "settings") {
        return Err(CommandError::new("invalid_view", "Unknown view"));
    }
    if let Some(main) = app.get_webview_window(MAIN) {
        warn_on_err("unminimize main", main.unminimize());
        warn_on_err("show main", main.show());
        warn_on_err("focus main", main.set_focus());
        warn_on_err(
            "emit main:navigate",
            app.emit_to(MAIN, "main:navigate", serde_json::json!({ "view": view })),
        );
        return Ok(());
    }
    // `view` is one of two literals (checked above), so it is safe to inline.
    let script = format!("window.__AVCHETAN_INITIAL_VIEW__ = '{view}';");
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
        }
        (DOCK, WindowEvent::Focused(false)) => {
            let dock = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(BLUR_HIDE_DELAY);
                if !dock.is_focused().unwrap_or(false) {
                    warn_on_err("hide dock on blur", dock.hide());
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
    }
    Ok(())
}

/// `async` because creating a window from a synchronous command deadlocks on Windows.
#[tauri::command(async)]
pub fn main_open(app: AppHandle, view: String) -> CommandResult<()> {
    open_main(&app, &view)
}
