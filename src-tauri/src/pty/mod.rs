//! PTY primitive. Domain-side (no `tauri::*`). The glue layer wiring this
//! to `tauri::ipc::Channel<Vec<u8>>` lives in `crate::commands::pty`.
//!
//! Layered: `types` (data), `coalesce` (async byte bucketing), `session`
//! (one PTY + reader thread + coalescer task), `registry` (PtyId map).

pub mod coalesce;
pub mod registry;
pub mod session;
pub mod types;
