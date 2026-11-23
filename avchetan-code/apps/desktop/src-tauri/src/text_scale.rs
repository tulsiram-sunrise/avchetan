//! Windows' own **Text size** (Settings → Accessibility → Text size), which WebView2 doesn't
//! apply to the page by itself (docs/product/tasks-routines-reminders.md §13). The webview asks
//! for it at start and whenever a window comes to the front, and scales its root font size.

/// Windows allows 100% to 225%; anything else (or no answer) is taken as 100%.
fn clamp(factor: f64) -> f64 {
    if factor.is_finite() {
        factor.clamp(1.0, 2.25)
    } else {
        1.0
    }
}

#[cfg(windows)]
fn read() -> f64 {
    use ::windows::UI::ViewManagement::UISettings;
    UISettings::new()
        .and_then(|settings| settings.TextScaleFactor())
        .unwrap_or(1.0)
}

#[cfg(not(windows))]
fn read() -> f64 {
    1.0
}

#[tauri::command]
pub fn text_scale() -> f64 {
    clamp(read())
}

#[cfg(test)]
mod tests {
    use super::clamp;

    #[test]
    fn keeps_windows_range() {
        assert_eq!(clamp(1.0), 1.0);
        assert_eq!(clamp(1.5), 1.5);
        assert_eq!(clamp(0.5), 1.0);
        assert_eq!(clamp(3.0), 2.25);
        assert_eq!(clamp(f64::NAN), 1.0);
    }
}
