//! The hub announces itself on the local network (docs/product/tasks-routines-reminders.md §15),
//! so a phone finds it at a new address without Tailscale. It registers a `_avchetan._tcp`
//! service with Windows' own mDNS responder (DNS-SD, Windows 10 1809 and later), which Windows'
//! firewall already lets answer on Private networks; the app opens no port of its own. The name
//! says only that a hub is here: a phone still checks it is its hub (ADR-0033).

/// The service type phones look for.
pub const SERVICE_TYPE: &str = "_avchetan._tcp.local";

/// The instance name: "Avchetan hub on <computer>", cut to fit a DNS label (63 bytes).
pub fn instance_name(computer: &str) -> String {
    let mut name = format!("Avchetan hub on {}", computer.trim());
    while name.len() > 63 {
        name.pop();
    }
    name
}

/// The computer's mDNS host name, `<name>.local`.
pub fn host_name(computer: &str) -> String {
    format!("{}.local", computer.trim())
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::NetworkManagement::Dns::{
        DnsServiceConstructInstance, DnsServiceDeRegister, DnsServiceFreeInstance,
        DnsServiceRegister, DNS_QUERY_REQUEST_VERSION1, DNS_SERVICE_INSTANCE,
        DNS_SERVICE_REGISTER_REQUEST,
    };

    /// `DNS_REQUEST_PENDING`: the call was accepted and finishes in the callback.
    const REQUEST_PENDING: u32 = 9506;

    /// Frees the copy Windows hands the callback, and logs a failure by its code only.
    unsafe extern "system" fn on_done(
        status: u32,
        _context: *const c_void,
        instance: *const DNS_SERVICE_INSTANCE,
    ) {
        if !instance.is_null() {
            // SAFETY: Windows passes an instance it allocated for this callback to free.
            unsafe { DnsServiceFreeInstance(instance) };
        }
        if status != 0 {
            log::warn!("hub announcement failed (code {status})");
        }
    }

    /// A registered service; dropping it withdraws the announcement.
    pub struct Announcement {
        request: DNS_SERVICE_REGISTER_REQUEST,
    }

    // SAFETY: the request only holds the instance this value owns; it is used from one thread
    // at a time, behind the hub state's lock.
    unsafe impl Send for Announcement {}

    impl Announcement {
        pub fn register(port: u16) -> Option<Self> {
            let computer = std::env::var("COMPUTERNAME").ok()?;
            let service = HSTRING::from(format!(
                "{}.{}",
                super::instance_name(&computer),
                super::SERVICE_TYPE
            ));
            let host = HSTRING::from(super::host_name(&computer));
            let key = HSTRING::from("v");
            let value = HSTRING::from("1");
            let keys = [PCWSTR(key.as_ptr())];
            let values = [PCWSTR(value.as_ptr())];
            // SAFETY: every string outlives the call, which copies them; addresses are left to
            // Windows, which answers for its own host name.
            let instance = unsafe {
                DnsServiceConstructInstance(
                    &service,
                    &host,
                    None,
                    None,
                    port,
                    0,
                    0,
                    1,
                    keys.as_ptr(),
                    values.as_ptr(),
                )
            };
            if instance.is_null() {
                log::warn!("could not describe the hub for its announcement");
                return None;
            }
            let request = DNS_SERVICE_REGISTER_REQUEST {
                Version: DNS_QUERY_REQUEST_VERSION1.0,
                InterfaceIndex: 0,
                pServiceInstance: instance,
                pRegisterCompletionCallback: Some(on_done),
                ..Default::default()
            };
            // SAFETY: the request and its instance live in the returned value until it drops.
            let status = unsafe { DnsServiceRegister(&request, None) };
            if status != REQUEST_PENDING {
                log::warn!("could not announce the hub (code {status})");
                // SAFETY: the instance was made above and nothing else holds it.
                unsafe { DnsServiceFreeInstance(instance) };
                return None;
            }
            log::info!("hub announced on the local network");
            Some(Self { request })
        }
    }

    impl Drop for Announcement {
        fn drop(&mut self) {
            // SAFETY: the same request that registered it; the instance is freed after.
            let status = unsafe { DnsServiceDeRegister(&self.request, None) };
            if status != REQUEST_PENDING {
                log::warn!("could not withdraw the hub announcement (code {status})");
            }
            // SAFETY: made in `register`, and Windows copied what it needs.
            unsafe { DnsServiceFreeInstance(self.request.pServiceInstance) };
        }
    }
}

#[cfg(not(windows))]
mod platform {
    /// Windows only for now (macOS/Linux are unscheduled).
    pub struct Announcement;

    impl Announcement {
        pub fn register(_port: u16) -> Option<Self> {
            None
        }
    }
}

pub use platform::Announcement;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_fit_dns_labels() {
        assert_eq!(instance_name(" DESK-1 "), "Avchetan hub on DESK-1");
        assert_eq!(instance_name(&"X".repeat(80)).len(), 63);
        assert_eq!(host_name("DESK-1"), "DESK-1.local");
    }

    /// By hand: `cargo test announces_for_a_while -- --ignored`, then look for it from a phone or
    /// another machine while it runs.
    #[test]
    #[ignore = "announces on the real network for 20 s"]
    fn announces_for_a_while() {
        let announcement = Announcement::register(8787);
        assert!(cfg!(not(windows)) || announcement.is_some());
        std::thread::sleep(std::time::Duration::from_secs(20));
        drop(announcement);
    }
}
