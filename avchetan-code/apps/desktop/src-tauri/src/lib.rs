//! Thin native shell (docs/architecture/desktop.md): windows, hotkeys, tray, clipboard, keychain and
//! SQLite access. All app logic lives in TypeScript in the webviews.

mod app_lock;
mod clipboard;
mod commands;
mod context;
mod detailed_log;
mod dock_look;
mod error;
mod hotkey;
mod mdns;
mod notify;
mod text_scale;
mod tray;
mod voice;
mod windows;

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// Largest log file before it is rotated, and how many old files are kept: about 5 MB in all.
const LOG_FILE_BYTES: u128 = 1_000_000;
const LOG_FILES_KEPT: usize = 4;

/// The log file (docs/conventions/errors-and-logging.md): `avchetan.log` in the app's log folder,
/// which Settings → Open log folder shows. The shell's `log::` lines and the webviews' logger
/// (src/platform/log-sink.ts) both go there. IDs, counts and codes only, never what was written.
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("avchetan".into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        // Debug records reach the filter, which keeps them only while the log is detailed (or in
        // development): the plugin's level can't change once it runs.
        .level(log::LevelFilter::Debug)
        .filter(|metadata| {
            detailed_log::keeps(
                metadata.level(),
                detailed_log::is_on(),
                cfg!(debug_assertions),
            )
        })
        // Libraries' details (requests, window events, each keychain read) stay out even in
        // development.
        .level_for("hyper", log::LevelFilter::Warn)
        .level_for("keyring", log::LevelFilter::Warn)
        .level_for("hyper_util", log::LevelFilter::Warn)
        .level_for("reqwest", log::LevelFilter::Warn)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("tracing", log::LevelFilter::Warn)
        .max_file_size(LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_KEPT))
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch exits before doing anything else.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_dock(app);
        }))
        // Second, so everything after it, the webviews included, can log.
        .plugin(log_plugin())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[windows::DOCK])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(hotkey::plugin())
        .setup(|app| {
            log::info!("started, version {}", app.package_info().version);
            // Before anything reads a secret, such as the hub's token at start.
            commands::secrets::use_service(&app.config().identifier);
            let data_dir = app.path().app_data_dir()?;
            app.manage(commands::db::DbState::new(data_dir.join("avchetan.db")));
            let hub = commands::hub::HubState::load(data_dir.join("hub"));
            hub.start_if_enabled();
            app.manage(hub);
            app.manage(voice::VoiceState::new(&data_dir));
            app.manage(app_lock::LockState::default());
            app_lock::watch_session(app.handle());
            app.manage(hotkey::HotkeyState::default());
            app.manage(hotkey::HoldState::default());
            hotkey::register_default(app.handle());
            tray::create(app)?;
            let backdrop = app
                .get_webview_window(windows::DOCK)
                .map_or(dock_look::Backdrop::None, |dock| dock_look::apply(&dock));
            app.manage(dock_look::LookState(backdrop));
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            app_lock::lock_status,
            app_lock::lock_configure,
            app_lock::lock_available,
            app_lock::lock_unlock,
            app_lock::lock_now,
            commands::data::backup_create,
            commands::data::backup_list,
            commands::data::data_folder_open,
            commands::data::export_write,
            commands::db::db_open,
            commands::db::db_run,
            commands::db::db_values,
            commands::db::db_batch,
            commands::db::db_rollback,
            commands::hub::hub_status,
            commands::hub::hub_configure,
            commands::hub::hub_import_data,
            commands::hub::hub_backup_list,
            commands::hub::hub_restore,
            commands::hub::hub_folder_open,
            commands::hub::hub_free_port,
            commands::log::log_set_detailed,
            commands::network::hub_network_status,
            commands::network::hub_network_allow,
            commands::network::network_settings_open,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            windows::dock_hide,
            dock_look::dock_look,
            dock_look::dock_fit,
            windows::main_open,
            hotkey::hotkey_status,
            hotkey::hotkey_set,
            hotkey::snap_hotkey_status,
            hotkey::snap_hotkey_set,
            tray::tray_set_pending,
            tray::tray_set_context,
            context::context_recent_apps,
            notify::brief_notify,
            notify::reminder_notify,
            text_scale::text_scale,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::voice_devices,
            voice::voice_model_status,
            voice::voice_model_delete,
            voice::voice_model_download,
            voice::voice_model_download_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Avchetan")
        .run(|app, event| {
            // Closing the hub's stdin stops it cleanly; it would also stop if this process died.
            if let RunEvent::Exit = event {
                app.state::<commands::hub::HubState>().stop();
            }
        });
}
