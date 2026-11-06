//! Tray icon: left-click toggles the dock; the menu opens the main window, pauses window
//! context (docs/product/window-context.md) or quits.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, Wry};

use crate::error::{warn_on_err, CommandError, CommandResult};
use crate::windows;

const TRAY_ID: &str = "avchetan";

pub struct TrayState {
    pending: MenuItem<Wry>,
    context: MenuItem<Wry>,
}

const PAUSE_CONTEXT: &str = "Pause window context for 1 hour";

pub fn create(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Avchetan", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "preferences", "Preferences", true, None::<&str>)?;
    let pending = MenuItem::with_id(app, "pending", "Pending: 0", false, None::<&str>)?;
    let context = MenuItem::with_id(app, "context", PAUSE_CONTEXT, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Avchetan", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &preferences,
            &PredefinedMenuItem::separator(app)?,
            &pending,
            &context,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Avchetan")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => warn_on_err(
                "open main",
                windows::open_main(app, "timeline", None).map_err(|e| e.message),
            ),
            "preferences" => {
                warn_on_err(
                    "open settings",
                    windows::open_main(app, "settings", None).map_err(|e| e.message),
                );
            }
            // The dock owns the setting: it pauses or resumes, then calls tray_set_context.
            "context" => warn_on_err(
                "emit context:toggle-pause",
                app.emit_to(windows::DOCK, "context:toggle-pause", ()),
            ),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::toggle_dock(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayState { pending, context });
    Ok(())
}

/// Called by the dock after each capture (and at startup).
#[tauri::command]
pub fn tray_set_pending(
    app: AppHandle,
    state: State<'_, TrayState>,
    count: u32,
) -> CommandResult<()> {
    let failed = |error: tauri::Error| CommandError::new("tray_failed", error.to_string());
    state
        .pending
        .set_text(format!("Pending: {count}"))
        .map_err(failed)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = match count {
            0 => "Avchetan".to_owned(),
            1 => "Avchetan: 1 entry waiting to be organized".to_owned(),
            n => format!("Avchetan: {n} entries waiting to be organized"),
        };
        tray.set_tooltip(Some(tooltip)).map_err(failed)?;
    }
    Ok(())
}

/// Called by the dock whenever window context is turned on or off, paused or resumed.
/// `paused_until` is the local time to show, e.g. "14:30".
#[tauri::command]
pub fn tray_set_context(
    state: State<'_, TrayState>,
    enabled: bool,
    paused_until: Option<String>,
) -> CommandResult<()> {
    let failed = |error: tauri::Error| CommandError::new("tray_failed", error.to_string());
    let text = match paused_until {
        Some(time) => format!("Resume window context (paused until {time})"),
        None => PAUSE_CONTEXT.to_owned(),
    };
    state.context.set_text(text).map_err(failed)?;
    state.context.set_enabled(enabled).map_err(failed)
}
