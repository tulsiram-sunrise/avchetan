//! The dock's look (docs/product/capture-box-redesign.md#3-the-new-look): a Windows 11 backdrop
//! behind a borderless rounded window, and a height that follows what the dock shows.
//!
//! Windows 11 22H2 and later get Acrylic through the system backdrop (Microsoft's material for
//! transient surfaces: it blurs the windows behind). Earlier Windows 11 gets Mica. Windows 10's
//! only acrylic is an undocumented API that lags while the window resizes, so it gets none and
//! the webview draws its own translucent panel instead.

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, Runtime, State, WebviewWindow};

use crate::error::{warn_on_err, CommandError, CommandResult};
use crate::windows::DOCK;

/// The dock's width, as in tauri.conf.json.
const WIDTH: f64 = 520.0;
/// Shorter than one input line plus padding makes no sense; taller would leave the screen.
const MIN_HEIGHT: f64 = 56.0;
const MAX_HEIGHT: f64 = 640.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Backdrop {
    Acrylic,
    Mica,
    None,
}

/// What `apply` put behind the dock; the webview asks with `dock_look`.
pub struct LookState(pub Backdrop);

/// The backdrop a Windows build gets (see the module comment).
pub fn backdrop_for_build(build: u32) -> Backdrop {
    if build >= 22_523 {
        Backdrop::Acrylic
    } else if build >= 22_000 {
        Backdrop::Mica
    } else {
        Backdrop::None
    }
}

/// Puts the backdrop behind the dock, with Windows' own rounded corners and shadow. Anything
/// that fails leaves the plain panel: the dock still works, it only looks flatter.
pub fn apply<R: Runtime>(dock: &WebviewWindow<R>) -> Backdrop {
    #[cfg(windows)]
    {
        let wanted = backdrop_for_build(windows_version::OsVersion::current().build);
        let applied = match wanted {
            Backdrop::Acrylic => window_vibrancy::apply_acrylic(dock, None),
            Backdrop::Mica => window_vibrancy::apply_mica(dock, None),
            Backdrop::None => return Backdrop::None,
        };
        if applied.is_err() {
            warn_on_err("dock backdrop", applied);
            return Backdrop::None;
        }
        warn_on_err("dock shadow", dock.set_shadow(true));
        round_corners(dock);
        wanted
    }
    #[cfg(not(windows))]
    {
        let _ = dock;
        Backdrop::None
    }
}

/// Borderless windows get square corners unless they ask (Windows 11 only; ignored before).
#[cfg(windows)]
fn round_corners<R: Runtime>(dock: &WebviewWindow<R>) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    let Ok(hwnd) = dock.hwnd() else {
        return;
    };
    let preference = DWMWCP_ROUND;
    // SAFETY: a live window handle, and a pointer to a value of the attribute's size.
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            std::ptr::from_ref(&preference).cast(),
            std::mem::size_of_val(&preference) as u32,
        )
    };
    if result != 0 {
        eprintln!("[avchetan] dock corners: {result:#x}");
    }
}

#[tauri::command]
pub fn dock_look(state: State<'_, LookState>) -> Backdrop {
    state.0
}

/// Fits the dock to what it shows. The top stays put, so the list grows downward.
#[tauri::command]
pub fn dock_fit(app: AppHandle, height: f64) -> CommandResult<()> {
    let Some(dock) = app.get_webview_window(DOCK) else {
        return Ok(());
    };
    if !height.is_finite() {
        return Err(CommandError::new("window_failed", "height is not a number"));
    }
    dock.set_size(LogicalSize::new(
        WIDTH,
        height.clamp(MIN_HEIGHT, MAX_HEIGHT),
    ))
    .map_err(|error| CommandError::new("window_failed", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{backdrop_for_build, Backdrop};

    #[test]
    fn windows_builds_get_their_backdrop() {
        assert_eq!(backdrop_for_build(19_045), Backdrop::None);
        assert_eq!(backdrop_for_build(22_000), Backdrop::Mica);
        assert_eq!(backdrop_for_build(22_621), Backdrop::Acrylic);
        assert_eq!(backdrop_for_build(26_100), Backdrop::Acrylic);
    }
}
