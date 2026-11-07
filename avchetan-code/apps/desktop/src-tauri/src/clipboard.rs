//! Clipboard snap (docs/product/clipboard-snap.md): the clipboard's text, read only when the
//! clipboard shortcut fires. Text only, cut here so at most `MAX_BYTES` reach the webview. The
//! switch and the deny-list are applied in TypeScript (`filterClipboard` in @avchetan/core).

use serde::Serialize;

/// 4 KB of UTF-8, as stored in `raw_logs.context.clipboard`.
pub const MAX_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ClipboardRead {
    Text { text: String, cut: bool },
    None { none: NoText },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoText {
    /// Nothing on the clipboard.
    Empty,
    /// An image, files or another format without text.
    NotText,
    /// Marked by the app that copied it as not for clipboard history (password managers).
    Private,
    /// Another app kept the clipboard open.
    Busy,
}

/// `\r\n` and lone `\r` become `\n`; then at most `max_bytes` of UTF-8, cut at a character
/// boundary. `cut` is true when anything was left out.
pub fn cut_text(text: &str, max_bytes: usize) -> (String, bool) {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.len() <= max_bytes {
        return (normalized, false);
    }
    let mut end = max_bytes;
    while !normalized.is_char_boundary(end) {
        end -= 1;
    }
    (normalized[..end].to_owned(), true)
}

/// Reads the clipboard's text now. Never fails: when there is no text, says why.
pub fn read_clipboard_text() -> ClipboardRead {
    read(MAX_BYTES)
}

#[cfg(windows)]
fn read(max_bytes: usize) -> ClipboardRead {
    win::read(max_bytes)
}

#[cfg(not(windows))]
fn read(_max_bytes: usize) -> ClipboardRead {
    ClipboardRead::None {
        none: NoText::Empty,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_kept_with_line_endings_made_newlines() {
        assert_eq!(
            cut_text("a\r\nb\rc\n", 100),
            ("a\nb\nc\n".to_owned(), false)
        );
    }

    #[test]
    fn long_text_is_cut_at_a_character_boundary() {
        // "é" is two bytes: 4097 bytes in all, and byte 4096 falls inside the last "é".
        let text = format!("{}é", "a".repeat(4095));
        let (kept, cut) = cut_text(&text, MAX_BYTES);
        assert!(cut);
        assert_eq!(kept, "a".repeat(4095));
    }

    #[test]
    fn exactly_the_limit_is_not_cut() {
        let text = "x".repeat(MAX_BYTES);
        assert_eq!(cut_text(&text, MAX_BYTES), (text.clone(), false));
    }

    #[test]
    fn no_text_serializes_as_its_reason() {
        let json = serde_json::to_string(&ClipboardRead::None {
            none: NoText::NotText,
        })
        .unwrap();
        assert_eq!(json, r#"{"none":"not_text"}"#);
        let json = serde_json::to_string(&ClipboardRead::Text {
            text: "hi".into(),
            cut: false,
        })
        .unwrap();
        assert_eq!(json, r#"{"text":"hi","cut":false}"#);
    }
}

#[cfg(windows)]
mod win {
    use std::time::Duration;

    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, CountClipboardFormats, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, RegisterClipboardFormatW,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    use super::{cut_text, ClipboardRead, NoText};

    /// `CF_UNICODETEXT` (Win32_System_Ole, which we don't otherwise need).
    const CF_UNICODETEXT: u32 = 13;
    /// Another app may hold the clipboard for a moment, for example while copying.
    const OPEN_TRIES: u32 = 5;
    const OPEN_WAIT: Duration = Duration::from_millis(20);

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Closes the clipboard when dropped, so every return path closes it once.
    struct Open;

    impl Open {
        fn new() -> Option<Self> {
            for attempt in 0..OPEN_TRIES {
                // SAFETY: a null owner associates the clipboard with this task; closed in Drop.
                if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                    return Some(Self);
                }
                if attempt + 1 < OPEN_TRIES {
                    std::thread::sleep(OPEN_WAIT);
                }
            }
            None
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY: opened in `Open::new`.
            unsafe { CloseClipboard() };
        }
    }

    fn format(name: &str) -> u32 {
        let name = wide(name);
        // SAFETY: NUL-terminated name; returns 0 on failure, which no clipboard holds.
        unsafe { RegisterClipboardFormatW(name.as_ptr()) }
    }

    fn available(format: u32) -> bool {
        // SAFETY: plain query.
        format != 0 && unsafe { IsClipboardFormatAvailable(format) } != 0
    }

    /// Password managers mark what they copy so Windows keeps it out of clipboard history:
    /// https://learn.microsoft.com/windows/win32/dataxchg/clipboard-formats#cloud-clipboard-and-clipboard-history-formats
    fn is_private() -> bool {
        if available(format("ExcludeClipboardContentFromMonitorProcessing")) {
            return true;
        }
        let history = format("CanIncludeInClipboardHistory");
        available(history) && read_bytes(history).is_some_and(|bytes| bytes.iter().all(|&b| b == 0))
    }

    /// The data of `format` as bytes, read under the global lock. The clipboard must be open.
    fn read_bytes(format: u32) -> Option<Vec<u8>> {
        // SAFETY: the clipboard is open; the handle belongs to the clipboard and isn't freed.
        let handle = unsafe { GetClipboardData(format) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: a clipboard handle is an HGLOBAL; unlocked below.
        let data = unsafe { GlobalLock(handle) };
        if data.is_null() {
            return None;
        }
        // SAFETY: the locked block has GlobalSize bytes.
        let bytes =
            unsafe { std::slice::from_raw_parts(data.cast::<u8>(), GlobalSize(handle)).to_vec() };
        // SAFETY: locked above.
        unsafe { GlobalUnlock(handle) };
        Some(bytes)
    }

    /// The text, reading at most enough UTF-16 units to fill `max_bytes` of UTF-8.
    fn read_text(max_bytes: usize) -> Option<(String, bool)> {
        // SAFETY: as in read_bytes, but reads only the units needed, not the whole block.
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: a clipboard handle is an HGLOBAL; unlocked below.
        let data = unsafe { GlobalLock(handle) }.cast::<u16>();
        if data.is_null() {
            return None;
        }
        // SAFETY: the block has GlobalSize bytes; we stay within it and stop at the NUL.
        let units = unsafe {
            let capacity = GlobalSize(handle) / 2;
            // Every UTF-16 unit is at least one byte of UTF-8, so this many is always enough.
            let wanted = capacity.min(max_bytes + 1);
            let slice = std::slice::from_raw_parts(data, wanted);
            let len = slice.iter().position(|&unit| unit == 0).unwrap_or(wanted);
            let longer = len == wanted && wanted < capacity && *data.add(wanted) != 0;
            (slice[..len].to_vec(), longer)
        };
        // SAFETY: locked above.
        unsafe { GlobalUnlock(handle) };
        let (mut units, longer) = units;
        // A pair split by the limit would read as a replacement character.
        if longer
            && units
                .last()
                .is_some_and(|&unit| (0xD800..0xDC00).contains(&unit))
        {
            units.pop();
        }
        let (text, cut) = cut_text(&String::from_utf16_lossy(&units), max_bytes);
        Some((text, cut || longer))
    }

    pub fn read(max_bytes: usize) -> ClipboardRead {
        let none = |reason| ClipboardRead::None { none: reason };
        let Some(_open) = Open::new() else {
            return none(NoText::Busy);
        };
        if is_private() {
            return none(NoText::Private);
        }
        if !available(CF_UNICODETEXT) {
            // SAFETY: plain query on the open clipboard.
            let formats = unsafe { CountClipboardFormats() };
            return none(if formats == 0 {
                NoText::Empty
            } else {
                NoText::NotText
            });
        }
        match read_text(max_bytes) {
            Some((text, cut)) if !text.trim().is_empty() => ClipboardRead::Text { text, cut },
            Some(_) => none(NoText::Empty),
            None => none(NoText::Busy),
        }
    }
}
