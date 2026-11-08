//! App lock (docs/product/app-lock.md): one lock state for both windows, kept here so no webview
//! decides on its own that it is unlocked. Unlocking uses Windows Hello; Avchetan stores no
//! passcode. The setting itself lives in the client-local `settings` table; the dock reads it at
//! start and passes it in with `lock_configure`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

use crate::error::{warn_on_err, CommandError, CommandResult};
use crate::windows::MAIN;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockAfter {
    Immediately,
    OneMinute,
    ThirtyMinutes,
}

impl LockAfter {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "immediately" => Some(Self::Immediately),
            "1m" => Some(Self::OneMinute),
            "30m" => Some(Self::ThirtyMinutes),
            _ => None,
        }
    }

    fn duration(self) -> Duration {
        match self {
            Self::Immediately => Duration::ZERO,
            Self::OneMinute => Duration::from_secs(60),
            Self::ThirtyMinutes => Duration::from_secs(30 * 60),
        }
    }
}

/// The lock's state machine, without windows or Hello, so it can be tested.
#[derive(Debug)]
struct Lock {
    /// False until the dock passes the setting in. Until then the main window waits.
    configured: bool,
    enabled: bool,
    after: LockAfter,
    locked: bool,
    away_since: Option<Instant>,
    /// Bumped whenever `away_since` changes, so a stale lock timer does nothing.
    away_generation: u64,
    /// The last unlock found no Windows Hello: turning the lock off is then allowed while locked.
    device_lock_gone: bool,
}

impl Lock {
    fn new() -> Self {
        Self {
            configured: false,
            enabled: false,
            after: LockAfter::OneMinute,
            locked: false,
            away_since: None,
            away_generation: 0,
            device_lock_gone: false,
        }
    }

    fn status(&self) -> LockStatus {
        LockStatus {
            configured: self.configured,
            enabled: self.enabled,
            locked: self.locked,
        }
    }

    /// The first call after start locks when the lock is on; later calls never lock.
    fn configure(&mut self, enabled: bool, after: LockAfter) -> Result<(), &'static str> {
        if self.configured && self.locked && !enabled && !self.device_lock_gone {
            return Err("locked");
        }
        if !self.configured {
            self.locked = enabled;
        } else if !enabled {
            self.locked = false;
        }
        self.configured = true;
        self.enabled = enabled;
        self.after = after;
        self.clear_away();
        Ok(())
    }

    fn clear_away(&mut self) {
        self.away_since = None;
        self.away_generation += 1;
    }

    /// Returns the timer to start, if any: lock after `Duration` unless the generation changed.
    fn mark_away(&mut self, now: Instant) -> Option<(Duration, u64)> {
        if !self.enabled || self.locked || self.away_since.is_some() {
            return None;
        }
        if self.after == LockAfter::Immediately {
            self.locked = true;
            return None;
        }
        self.away_since = Some(now);
        self.away_generation += 1;
        Some((self.after.duration(), self.away_generation))
    }

    fn mark_back(&mut self, now: Instant) {
        if let Some(since) = self.away_since {
            if self.enabled && now.duration_since(since) >= self.after.duration() {
                self.locked = true;
            }
        }
        self.clear_away();
    }

    /// A lock timer fired. True when it locked.
    fn timer_fired(&mut self, generation: u64) -> bool {
        if generation != self.away_generation || self.away_since.is_none() || self.locked {
            return false;
        }
        self.locked = true;
        self.clear_away();
        true
    }

    fn lock_now(&mut self) -> bool {
        self.clear_away();
        if !self.enabled || self.locked {
            return false;
        }
        self.locked = true;
        true
    }

    fn unlocked(&mut self) {
        self.locked = false;
        self.device_lock_gone = false;
        self.clear_away();
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct LockStatus {
    configured: bool,
    enabled: bool,
    locked: bool,
}

pub struct LockState {
    lock: Mutex<Lock>,
    /// Windows Hello is on screen: the dock must not hide when it loses focus to it.
    prompting: AtomicBool,
}

impl Default for LockState {
    fn default() -> Self {
        Self {
            lock: Mutex::new(Lock::new()),
            prompting: AtomicBool::new(false),
        }
    }
}

impl LockState {
    pub fn is_prompting(&self) -> bool {
        self.prompting.load(Ordering::SeqCst)
    }

    fn with<T>(&self, f: impl FnOnce(&mut Lock) -> T) -> T {
        let mut lock = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut lock)
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>) {
    let status = app.state::<LockState>().with(|lock| lock.status());
    warn_on_err("emit lock:changed", app.emit("lock:changed", status));
}

/// The main window is on screen (shown and not minimized).
fn main_showing<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(MAIN).is_some_and(|main| {
        main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false)
    })
}

/// The main window was hidden or minimized.
pub fn mark_away<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LockState>();
    let (timer, locked) = state.with(|lock| (lock.mark_away(Instant::now()), lock.locked));
    if locked {
        emit_status(app);
    }
    if let Some((wait, generation)) = timer {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            if app
                .state::<LockState>()
                .with(|lock| lock.timer_fired(generation))
            {
                emit_status(&app);
            }
        });
    }
}

/// The main window is back in front.
pub fn mark_back<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LockState>();
    let before = state.with(|lock| lock.locked);
    let after = state.with(|lock| {
        lock.mark_back(Instant::now());
        lock.locked
    });
    if before != after {
        emit_status(app);
    }
}

/// Windows locked or is going to sleep.
pub fn lock_now<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<LockState>().with(|lock| lock.lock_now()) {
        emit_status(app);
    }
}

#[tauri::command]
pub fn lock_status(state: State<'_, LockState>) -> LockStatus {
    state.with(|lock| lock.status())
}

#[tauri::command]
pub fn lock_configure(app: AppHandle, enabled: bool, after: String) -> CommandResult<LockStatus> {
    let after = LockAfter::parse(&after)
        .ok_or_else(|| CommandError::new("invalid_input", "Unknown lock time"))?;
    app.state::<LockState>()
        .with(|lock| lock.configure(enabled, after))
        .map_err(|_| CommandError::new("app_locked", "Unlock Avchetan first"))?;
    emit_status(&app);
    if enabled && !main_showing(&app) {
        mark_away(&app);
    }
    Ok(app.state::<LockState>().with(|lock| lock.status()))
}

/// `available` or `unavailable` (no Windows Hello set up for this user).
#[tauri::command(async)]
pub fn lock_available() -> String {
    if hello::available() {
        "available".into()
    } else {
        "unavailable".into()
    }
}

/// Shows Windows Hello over the calling window. Returns `verified`, `cancelled`, `unavailable`
/// or `failed`; only `verified` unlocks. Also used to confirm turning the lock on or off.
#[tauri::command(async)]
pub fn lock_unlock(app: AppHandle, window: WebviewWindow, reason: String) -> String {
    let state = app.state::<LockState>();
    if state.prompting.swap(true, Ordering::SeqCst) {
        return "failed".into();
    }
    let hwnd = window_handle(&window);
    let outcome = hello::verify(hwnd, &reason);
    state.prompting.store(false, Ordering::SeqCst);
    warn_on_err("focus after unlock", window.set_focus());
    match outcome {
        hello::Outcome::Verified => {
            state.with(Lock::unlocked);
            emit_status(&app);
            if !main_showing(&app) {
                mark_away(&app);
            }
            "verified".into()
        }
        hello::Outcome::Cancelled => "cancelled".into(),
        hello::Outcome::Unavailable => {
            state.with(|lock| lock.device_lock_gone = true);
            "unavailable".into()
        }
        hello::Outcome::Failed => "failed".into(),
    }
}

#[cfg(windows)]
fn window_handle(window: &WebviewWindow) -> isize {
    window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
fn window_handle(_window: &WebviewWindow) -> isize {
    0
}

#[cfg(windows)]
mod hello {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::{
        IUserConsentVerifierInterop, RoInitialize, RO_INIT_MULTITHREADED,
    };
    use windows_future::IAsyncOperation;

    pub enum Outcome {
        Verified,
        Cancelled,
        Unavailable,
        Failed,
    }

    /// WinRT calls run on a thread of their own, in the multithreaded apartment.
    fn on_winrt_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        std::thread::spawn(move || {
            // Already initialised in another mode is fine; the call below reports real failures.
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
            f()
        })
        .join()
        .ok()
    }

    pub fn available() -> bool {
        on_winrt_thread(|| {
            UserConsentVerifier::CheckAvailabilityAsync()
                .and_then(|operation| operation.join())
                .is_ok_and(|availability| {
                    availability == UserConsentVerifierAvailability::Available
                })
        })
        .unwrap_or(false)
    }

    pub fn verify(hwnd: isize, reason: &str) -> Outcome {
        let reason = HSTRING::from(reason);
        on_winrt_thread(move || {
            let result = (|| -> windows::core::Result<UserConsentVerificationResult> {
                let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
                // Owned by the calling window, so Hello appears in front of the always-on-top dock.
                let operation: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                    interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut _), &reason)
                }?;
                operation.join()
            })();
            match result {
                Ok(UserConsentVerificationResult::Verified) => Outcome::Verified,
                Ok(UserConsentVerificationResult::Canceled) => Outcome::Cancelled,
                Ok(
                    UserConsentVerificationResult::DeviceNotPresent
                    | UserConsentVerificationResult::NotConfiguredForUser
                    | UserConsentVerificationResult::DisabledByPolicy,
                ) => Outcome::Unavailable,
                Ok(_) => Outcome::Failed,
                Err(error) => {
                    eprintln!("[avchetan] windows hello failed: {}", error.code());
                    Outcome::Failed
                }
            }
        })
        .unwrap_or(Outcome::Failed)
    }
}

#[cfg(not(windows))]
mod hello {
    pub enum Outcome {
        Verified,
        Cancelled,
        Unavailable,
        Failed,
    }

    pub fn available() -> bool {
        false
    }

    pub fn verify(_hwnd: isize, _reason: &str) -> Outcome {
        Outcome::Unavailable
    }
}

/// Locks the app when Windows locks the session or goes to sleep. A hidden top-level window of
/// its own receives both notices (message-only windows get neither).
#[cfg(windows)]
pub fn watch_session<R: Runtime>(app: &AppHandle<R>) {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
        TranslateMessage, MSG, PBT_APMSUSPEND, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW,
        WS_OVERLAPPED,
    };

    /// `WTS_SESSION_LOCK` (wtsapi32.h).
    const WTS_SESSION_LOCK: usize = 0x7;

    static ON_LOCK: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let lock = (message == WM_WTSSESSION_CHANGE && wparam == WTS_SESSION_LOCK)
            || (message == WM_POWERBROADCAST && wparam == PBT_APMSUSPEND as usize);
        if lock {
            if let Some(on_lock) = ON_LOCK.get() {
                on_lock();
            }
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }

    let app = app.clone();
    if ON_LOCK.set(Box::new(move || lock_now(&app))).is_err() {
        return;
    }
    std::thread::spawn(|| unsafe {
        let class_name: Vec<u16> = "AvchetanSessionWatch\0".encode_utf16().collect();
        let instance = GetModuleHandleW(std::ptr::null());
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&class);
        // Never shown: a top-level window, because message-only windows miss both broadcasts.
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            eprintln!("[avchetan] session watch: no window");
            return;
        }
        if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) == 0 {
            eprintln!("[avchetan] session watch: not registered");
        }
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}

#[cfg(not(windows))]
pub fn watch_session<R: Runtime>(_app: &AppHandle<R>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured(enabled: bool, after: LockAfter) -> Lock {
        let mut lock = Lock::new();
        lock.configure(enabled, after).unwrap();
        lock
    }

    #[test]
    fn starts_locked_only_when_on() {
        assert!(configured(true, LockAfter::OneMinute).locked);
        assert!(!configured(false, LockAfter::OneMinute).locked);
    }

    #[test]
    fn turning_on_later_does_not_lock() {
        let mut lock = configured(false, LockAfter::OneMinute);
        lock.configure(true, LockAfter::OneMinute).unwrap();
        assert!(!lock.locked);
    }

    #[test]
    fn turning_off_while_locked_is_refused_unless_hello_is_gone() {
        let mut lock = configured(true, LockAfter::OneMinute);
        assert!(lock.configure(false, LockAfter::OneMinute).is_err());
        lock.device_lock_gone = true;
        lock.configure(false, LockAfter::OneMinute).unwrap();
        assert!(!lock.locked);
    }

    #[test]
    fn locks_after_the_chosen_time_away() {
        let mut lock = configured(true, LockAfter::OneMinute);
        lock.unlocked();
        let start = Instant::now();
        assert!(lock.mark_away(start).is_some());
        lock.mark_back(start + Duration::from_secs(59));
        assert!(!lock.locked);
        lock.mark_away(start);
        lock.mark_back(start + Duration::from_secs(60));
        assert!(lock.locked);
    }

    #[test]
    fn immediately_locks_on_leaving() {
        let mut lock = configured(true, LockAfter::Immediately);
        lock.unlocked();
        assert!(lock.mark_away(Instant::now()).is_none());
        assert!(lock.locked);
    }

    #[test]
    fn a_stale_timer_does_nothing() {
        let mut lock = configured(true, LockAfter::OneMinute);
        lock.unlocked();
        let (_, generation) = lock.mark_away(Instant::now()).unwrap();
        lock.mark_back(Instant::now());
        assert!(!lock.timer_fired(generation));
        assert!(!lock.locked);
        let (_, generation) = lock.mark_away(Instant::now()).unwrap();
        assert!(lock.timer_fired(generation));
        assert!(lock.locked);
    }

    #[test]
    fn windows_locking_locks_at_once() {
        let mut lock = configured(true, LockAfter::ThirtyMinutes);
        lock.unlocked();
        assert!(lock.lock_now());
        assert!(lock.locked);
        assert!(!configured(false, LockAfter::OneMinute).lock_now());
    }

    #[test]
    fn lock_times_parse() {
        assert_eq!(
            LockAfter::parse("immediately"),
            Some(LockAfter::Immediately)
        );
        assert_eq!(LockAfter::parse("1m"), Some(LockAfter::OneMinute));
        assert_eq!(LockAfter::parse("30m"), Some(LockAfter::ThirtyMinutes));
        assert_eq!(LockAfter::parse("5m"), None);
    }
}
