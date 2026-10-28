//! The global shortcut that summons the dock (default Ctrl+Shift+Space, configurable).

use std::sync::Mutex;

use serde::Serialize;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::error::{warn_on_err, CommandError, CommandResult};
use crate::windows;

/// Must match DEFAULT_HOTKEY in src/services/hotkey.ts.
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

#[derive(Clone, Serialize)]
pub struct HotkeyStatus {
    /// As the user wrote it (shown in the UI and saved in settings).
    shortcut: String,
    registered: bool,
    /// `hotkey_unavailable` or `hotkey_invalid` (troubleshooting.md anchors).
    error: Option<&'static str>,
}

struct Active {
    status: HotkeyStatus,
    shortcut: Option<Shortcut>,
}

pub struct HotkeyState(Mutex<Active>);

impl Default for HotkeyState {
    fn default() -> Self {
        Self(Mutex::new(Active {
            status: HotkeyStatus {
                shortcut: DEFAULT_SHORTCUT.to_owned(),
                registered: false,
                error: None,
            },
            shortcut: None,
        }))
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                windows::toggle_dock(app);
            }
        })
        .build()
}

/// Registers `accelerator`, replacing the current shortcut only if that succeeds, so a
/// failed change leaves the old shortcut working.
fn register<R: Runtime>(app: &AppHandle<R>, state: &HotkeyState, accelerator: &str) -> HotkeyStatus {
    let accelerator = accelerator.trim();
    let failed = |error| HotkeyStatus {
        shortcut: accelerator.to_owned(),
        registered: false,
        error: Some(error),
    };
    let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
        return failed("hotkey_invalid");
    };
    let Ok(mut active) = state.0.lock() else {
        return failed("hotkey_unavailable");
    };
    if active.shortcut == Some(shortcut) {
        active.status.shortcut = accelerator.to_owned();
        return active.status.clone();
    }

    let shortcuts = app.global_shortcut();
    if shortcuts.register(shortcut).is_err() {
        // Keep reporting the first failure at startup; a later failed change keeps the old one.
        if active.shortcut.is_none() {
            active.status = failed("hotkey_unavailable");
        }
        return failed("hotkey_unavailable");
    }
    if let Some(previous) = active.shortcut.replace(shortcut) {
        warn_on_err("unregister previous shortcut", shortcuts.unregister(previous));
    }
    active.status = HotkeyStatus {
        shortcut: accelerator.to_owned(),
        registered: true,
        error: None,
    };
    active.status.clone()
}

/// At startup. Failure is not fatal: the tray still opens the dock, and the dock shows a
/// banner pointing to Settings.
pub fn register_default<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<HotkeyState>();
    let status = register(app, &state, DEFAULT_SHORTCUT);
    if !status.registered {
        eprintln!("[avchetan] default shortcut unavailable");
    }
}

#[tauri::command]
pub fn hotkey_status(state: State<'_, HotkeyState>) -> CommandResult<HotkeyStatus> {
    state
        .0
        .lock()
        .map(|active| active.status.clone())
        .map_err(|_| CommandError::new("hotkey_unavailable", "Shortcut state poisoned"))
}

#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    state: State<'_, HotkeyState>,
    shortcut: String,
) -> CommandResult<HotkeyStatus> {
    Ok(register(&app, &state, &shortcut))
}
