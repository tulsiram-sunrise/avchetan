//! The global shortcuts: one summons the dock (default Ctrl+Shift+Space), the other opens it
//! with the clipboard attached (clipboard snap, default Ctrl+Shift+Alt+Space). Both are
//! configurable; they can't be the same keys.

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
    /// As the user wrote it (shown in the UI and saved in settings); empty when turned off.
    shortcut: String,
    registered: bool,
    /// `hotkey_unavailable` or `hotkey_invalid` (troubleshooting.md anchors).
    error: Option<&'static str>,
}

impl HotkeyStatus {
    fn off(shortcut: &str) -> Self {
        Self {
            shortcut: shortcut.to_owned(),
            registered: false,
            error: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Which {
    /// Opens or hides the dock (window context only).
    Dock,
    /// Opens the dock with the clipboard attached; registered by the dock's webview when the
    /// setting is on (docs/product/clipboard-snap.md).
    Snap,
}

struct Slot {
    status: HotkeyStatus,
    shortcut: Option<Shortcut>,
}

struct Slots {
    dock: Slot,
    snap: Slot,
}

impl Slots {
    fn get(&mut self, which: Which) -> &mut Slot {
        match which {
            Which::Dock => &mut self.dock,
            Which::Snap => &mut self.snap,
        }
    }

    fn other(&self, which: Which) -> Option<Shortcut> {
        match which {
            Which::Dock => self.snap.shortcut,
            Which::Snap => self.dock.shortcut,
        }
    }

    /// Which shortcut fired; the dock's unless it is the snap one.
    fn which(&self, shortcut: &Shortcut) -> Which {
        if self.snap.shortcut.as_ref() == Some(shortcut) {
            Which::Snap
        } else {
            Which::Dock
        }
    }
}

pub struct HotkeyState(Mutex<Slots>);

impl Default for HotkeyState {
    fn default() -> Self {
        Self(Mutex::new(Slots {
            dock: Slot {
                status: HotkeyStatus::off(DEFAULT_SHORTCUT),
                shortcut: None,
            },
            snap: Slot {
                status: HotkeyStatus::off(""),
                shortcut: None,
            },
        }))
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            // Decide under the lock, act after it: showing the dock reads other windows.
            let which = app
                .try_state::<HotkeyState>()
                .and_then(|state| state.0.lock().ok().map(|slots| slots.which(shortcut)))
                .unwrap_or(Which::Dock);
            match which {
                Which::Dock => windows::toggle_dock_from_hotkey(app),
                Which::Snap => windows::show_dock_with_clipboard(app),
            }
        })
        .build()
}

/// Registers `accelerator` for `which`, replacing its current shortcut only if that succeeds,
/// so a failed change leaves the old one working. An empty accelerator turns the snap
/// shortcut off.
fn register<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
    which: Which,
    accelerator: &str,
) -> HotkeyStatus {
    let accelerator = accelerator.trim();
    let failed = |error| HotkeyStatus {
        shortcut: accelerator.to_owned(),
        registered: false,
        error: Some(error),
    };
    let Ok(mut slots) = state.0.lock() else {
        return failed("hotkey_unavailable");
    };
    let shortcuts = app.global_shortcut();

    if accelerator.is_empty() && which == Which::Snap {
        let slot = slots.get(which);
        if let Some(previous) = slot.shortcut.take() {
            warn_on_err("unregister snap shortcut", shortcuts.unregister(previous));
        }
        slot.status = HotkeyStatus::off("");
        return slot.status.clone();
    }
    let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
        return failed("hotkey_invalid");
    };
    if slots.other(which) == Some(shortcut) {
        return failed("hotkey_invalid");
    }
    let slot = slots.get(which);
    if slot.shortcut == Some(shortcut) {
        slot.status.shortcut = accelerator.to_owned();
        return slot.status.clone();
    }

    if shortcuts.register(shortcut).is_err() {
        // Keep reporting the first failure; a later failed change keeps the old one.
        if slot.shortcut.is_none() {
            slot.status = failed("hotkey_unavailable");
        }
        return failed("hotkey_unavailable");
    }
    if let Some(previous) = slot.shortcut.replace(shortcut) {
        warn_on_err(
            "unregister previous shortcut",
            shortcuts.unregister(previous),
        );
    }
    slot.status = HotkeyStatus {
        shortcut: accelerator.to_owned(),
        registered: true,
        error: None,
    };
    slot.status.clone()
}

/// At startup. Failure is not fatal: the tray still opens the dock, and the dock shows a
/// banner pointing to Settings. The snap shortcut waits for the dock to read its setting.
pub fn register_default<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<HotkeyState>();
    let status = register(app, &state, Which::Dock, DEFAULT_SHORTCUT);
    if !status.registered {
        eprintln!("[avchetan] default shortcut unavailable");
    }
}

fn status(state: &HotkeyState, which: Which) -> CommandResult<HotkeyStatus> {
    state
        .0
        .lock()
        .map(|mut slots| slots.get(which).status.clone())
        .map_err(|_| CommandError::new("hotkey_unavailable", "Shortcut state poisoned"))
}

#[tauri::command]
pub fn hotkey_status(state: State<'_, HotkeyState>) -> CommandResult<HotkeyStatus> {
    status(&state, Which::Dock)
}

#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    state: State<'_, HotkeyState>,
    shortcut: String,
) -> CommandResult<HotkeyStatus> {
    Ok(register(&app, &state, Which::Dock, &shortcut))
}

#[tauri::command]
pub fn snap_hotkey_status(state: State<'_, HotkeyState>) -> CommandResult<HotkeyStatus> {
    status(&state, Which::Snap)
}

/// `shortcut` empty turns clipboard snap off.
#[tauri::command]
pub fn snap_hotkey_set(
    app: AppHandle,
    state: State<'_, HotkeyState>,
    shortcut: String,
) -> CommandResult<HotkeyStatus> {
    Ok(register(&app, &state, Which::Snap, &shortcut))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots_with(dock: &str, snap: &str) -> Slots {
        let slot = |accelerator: &str| Slot {
            status: HotkeyStatus::off(accelerator),
            shortcut: Some(accelerator.parse().unwrap()),
        };
        Slots {
            dock: slot(dock),
            snap: slot(snap),
        }
    }

    #[test]
    fn tells_the_two_shortcuts_apart() {
        let slots = slots_with("Ctrl+Shift+Space", "Ctrl+Shift+Alt+Space");
        let snap: Shortcut = "ctrl+shift+alt+space".parse().unwrap();
        let dock: Shortcut = "ctrl+shift+space".parse().unwrap();
        assert_eq!(slots.which(&snap), Which::Snap);
        assert_eq!(slots.which(&dock), Which::Dock);
    }

    #[test]
    fn the_dock_shortcut_never_counts_as_snap_when_snap_is_off() {
        let mut slots = slots_with("Ctrl+Shift+Space", "Ctrl+Shift+Alt+Space");
        slots.snap.shortcut = None;
        let dock: Shortcut = "ctrl+shift+space".parse().unwrap();
        assert_eq!(slots.which(&dock), Which::Dock);
    }

    #[test]
    fn each_slot_knows_the_other_ones_keys() {
        let slots = slots_with("Ctrl+Shift+Space", "Ctrl+Shift+Alt+Space");
        assert_eq!(slots.other(Which::Snap), slots.dock.shortcut);
        assert_eq!(slots.other(Which::Dock), slots.snap.shortcut);
    }
}
