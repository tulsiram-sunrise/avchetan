//! *Detailed log for 1 hour* (docs/conventions/errors-and-logging.md). The webviews own the
//! setting and its hour; they tell the shell (`log_set_detailed`), which then keeps `debug`
//! records in the log file and tells the built-in hub.

use std::sync::atomic::{AtomicBool, Ordering};

static DETAILED: AtomicBool = AtomicBool::new(false);

pub fn is_on() -> bool {
    DETAILED.load(Ordering::Relaxed)
}

/// Whether this switched it (both windows report the same change).
pub fn set(on: bool) -> bool {
    DETAILED.swap(on, Ordering::Relaxed) != on
}

/// Whether the log file keeps a record: `info` and up always, `debug` while detailed (and in a
/// development build).
pub fn keeps(level: log::Level, detailed: bool, development: bool) -> bool {
    level <= log::Level::Info || detailed || development
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_debug_only_while_detailed() {
        assert!(keeps(log::Level::Info, false, false));
        assert!(keeps(log::Level::Error, false, false));
        assert!(!keeps(log::Level::Debug, false, false));
        assert!(keeps(log::Level::Debug, true, false));
        assert!(keeps(log::Level::Debug, false, true));
        assert!(!keeps(log::Level::Trace, false, false));
    }
}
