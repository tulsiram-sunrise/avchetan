//! The window that was in front when the hotkey fired (docs/product/window-context.md).
//! Read before the dock takes focus. Raw facts only: the switch, the pause, the deny-list and
//! browsers are applied in TypeScript (`filterContext` in @avchetan/core), where the settings are.

use std::sync::Mutex;

use serde::Serialize;

use crate::error::CommandResult;

/// The last apps seen, newest first, for the deny-list's "Recent apps". Memory only.
const RECENT_APPS: usize = 10;
static RECENT: Mutex<Vec<RecentApp>> = Mutex::new(Vec::new());

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RecentApp {
    pub app: String,
    pub app_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WindowContext {
    /// The program's file name, e.g. `Code.exe`.
    pub app: String,
    /// The program's own description, e.g. `Visual Studio Code`; the file name without its
    /// extension when it has none.
    pub app_name: String,
    pub window_title: String,
}

/// `None` for Avchetan's own windows, the desktop, the taskbar, or when Windows won't say.
pub fn previous_window_context() -> Option<WindowContext> {
    let context = read_foreground();
    if let Some(context) = &context {
        remember(
            &mut RECENT.lock().unwrap_or_else(|e| e.into_inner()),
            context,
        );
    }
    context
}

#[cfg(windows)]
fn read_foreground() -> Option<WindowContext> {
    win::foreground_window().and_then(|hwnd| win::context_of(hwnd, std::process::id()))
}

#[cfg(not(windows))]
fn read_foreground() -> Option<WindowContext> {
    None
}

fn remember(recent: &mut Vec<RecentApp>, context: &WindowContext) {
    recent.retain(|seen| !seen.app.eq_ignore_ascii_case(&context.app));
    recent.insert(
        0,
        RecentApp {
            app: context.app.clone(),
            app_name: context.app_name.clone(),
        },
    );
    recent.truncate(RECENT_APPS);
}

/// Settings → Window context → deny-list: the apps the hotkey was used over lately.
#[tauri::command]
pub fn context_recent_apps() -> CommandResult<Vec<RecentApp>> {
    Ok(RECENT.lock().unwrap_or_else(|e| e.into_inner()).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(app: &str) -> WindowContext {
        WindowContext {
            app: app.to_owned(),
            app_name: app.to_owned(),
            window_title: String::new(),
        }
    }

    #[test]
    fn keeps_the_last_ten_apps_newest_first_without_repeats() {
        let mut recent = Vec::new();
        for n in 0..12 {
            remember(&mut recent, &seen(&format!("app{n}.exe")));
        }
        remember(&mut recent, &seen("APP5.exe"));
        assert_eq!(recent.len(), 10);
        assert_eq!(recent[0].app, "APP5.exe");
        assert_eq!(
            recent
                .iter()
                .filter(|r| r.app.eq_ignore_ascii_case("app5.exe"))
                .count(),
            1
        );
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{CloseHandle, HWND};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    use super::WindowContext;

    /// The desktop and the taskbar: no app to speak of.
    const SHELL_CLASSES: [&str; 4] = [
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    ];

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn foreground_window() -> Option<HWND> {
        // SAFETY: no arguments; returns null when no window is in front.
        let hwnd = unsafe { GetForegroundWindow() };
        (!hwnd.is_null()).then_some(hwnd)
    }

    pub fn context_of(hwnd: HWND, own_pid: u32) -> Option<WindowContext> {
        let mut pid = 0u32;
        // SAFETY: hwnd came from Windows; pid is a valid out pointer.
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 || pid == own_pid || SHELL_CLASSES.contains(&class_name(hwnd).as_str()) {
            return None;
        }
        let path = process_path(pid)?;
        let app = Path::new(&path).file_name()?.to_string_lossy().into_owned();
        // Store apps often have no readable description: `Notepad` for Notepad.exe.
        let app_name = file_description(&path).unwrap_or_else(|| {
            Path::new(&app)
                .file_stem()
                .map_or_else(|| app.clone(), |stem| stem.to_string_lossy().into_owned())
        });
        Some(WindowContext {
            app,
            app_name,
            window_title: window_title(hwnd),
        })
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buffer = [0u16; 256];
        // SAFETY: the buffer length is passed with the buffer.
        let len = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..len.max(0) as usize])
    }

    fn window_title(hwnd: HWND) -> String {
        let mut buffer = [0u16; 512];
        // SAFETY: the buffer length is passed with the buffer.
        let len = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..len.max(0) as usize])
    }

    fn process_path(pid: u32) -> Option<String> {
        // SAFETY: limited query rights only; the handle is closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return None;
        }
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        // SAFETY: len holds the buffer's length and receives the path's length.
        let ok = unsafe {
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut len)
        };
        // SAFETY: opened above, closed once.
        unsafe { CloseHandle(process) };
        (ok != 0).then(|| String::from_utf16_lossy(&buffer[..len as usize]))
    }

    /// The `FileDescription` from the program's version resource, in its first language.
    fn file_description(path: &str) -> Option<String> {
        let path = wide(path);
        // SAFETY: path is NUL-terminated; the size call needs no handle.
        let size = unsafe { GetFileVersionInfoSizeW(path.as_ptr(), std::ptr::null_mut()) };
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        // SAFETY: data has `size` bytes.
        let ok = unsafe { GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr().cast()) };
        if ok == 0 {
            return None;
        }
        let translation = query(&data, "\\VarFileInfo\\Translation")?;
        if translation.len() < 4 {
            return None;
        }
        let language = u16::from_le_bytes([translation[0], translation[1]]);
        let code_page = u16::from_le_bytes([translation[2], translation[3]]);
        let key = format!("\\StringFileInfo\\{language:04x}{code_page:04x}\\FileDescription");
        let value = query(&data, &key)?;
        let units: Vec<u16> = value
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .take_while(|&unit| unit != 0)
            .collect();
        let text = String::from_utf16_lossy(&units).trim().to_owned();
        (!text.is_empty()).then_some(text)
    }

    /// A value inside the version resource, as bytes borrowed from `data`.
    fn query<'a>(data: &'a [u8], key: &str) -> Option<&'a [u8]> {
        let key = wide(key);
        let mut value: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        // SAFETY: data is a version resource read by GetFileVersionInfoW; value points into it.
        let ok =
            unsafe { VerQueryValueW(data.as_ptr().cast(), key.as_ptr(), &mut value, &mut len) };
        if ok == 0 || value.is_null() {
            return None;
        }
        // String values count UTF-16 units, binary values count bytes; read the larger and
        // stop at the end of `data`.
        let start = value as usize - data.as_ptr() as usize;
        let end = (start + len as usize * 2).min(data.len());
        data.get(start..end)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_window_that_does_not_exist_has_no_context() {
            let hwnd = 1usize as HWND;
            assert_eq!(context_of(hwnd, std::process::id()), None);
        }

        #[test]
        fn reads_a_system_programs_description() {
            let notepad = std::env::var("WINDIR").unwrap() + "\\System32\\notepad.exe";
            let description = file_description(&notepad).expect("notepad has a description");
            assert!(description.to_lowercase().contains("notepad"));
        }
    }
}
