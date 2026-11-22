use tauri::State;

use super::hub::HubState;

/// The webviews' *Detailed log for 1 hour* turned on or off: debug records in the log file, and
/// the built-in hub told. Both windows call it; only a real change reaches the hub.
#[tauri::command]
pub fn log_set_detailed(detailed: bool, hub: State<'_, HubState>) {
    if crate::detailed_log::set(detailed) {
        log::info!("detailed log {}", if detailed { "on" } else { "off" });
        hub.set_detailed_log(detailed);
    }
}
