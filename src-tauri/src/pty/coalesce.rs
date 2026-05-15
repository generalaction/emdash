//! Sender-side coalescing: flush on whichever fires first — 16 KiB
//! buffered or 4 ms since the last byte. Domain-side; sink is a generic
//! `Fn(Vec<u8>) + Send` so it stays free of `tauri::ipc::Channel`.
