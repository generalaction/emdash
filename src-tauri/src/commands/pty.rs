//! Tauri glue for the PTY domain. Every byte of output flows through
//! `tauri::ipc::Channel<Vec<u8>>` — above the 1 KiB threshold this lands
//! on Tauri's raw-fetch transport, so the per-flush JSON-array overhead
//! from tauri#13405 does not apply (see ADR-0003).

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::pty::registry::Registry;
use crate::pty::types::{PtyError, PtyId, PtySize, SpawnOptions};

#[tauri::command]
#[specta::specta]
pub async fn pty_spawn(
    registry: State<'_, Arc<Registry>>,
    opts: SpawnOptions,
    on_data: Channel<Vec<u8>>,
) -> Result<PtyId, PtyError> {
    registry.spawn(opts, move |bytes| {
        // Channel::send is fire-and-forget; we have no backpressure signal
        // from the webview, so we just log the failure mode on first sight.
        // See ADR-0003 for the (intentional) loss-tolerance.
        let _ = on_data.send(bytes);
    })
}

#[tauri::command]
#[specta::specta]
pub async fn pty_write(
    registry: State<'_, Arc<Registry>>,
    id: PtyId,
    bytes: Vec<u8>,
) -> Result<(), PtyError> {
    registry.write(id, &bytes)
}

#[tauri::command]
#[specta::specta]
pub async fn pty_resize(
    registry: State<'_, Arc<Registry>>,
    id: PtyId,
    size: PtySize,
) -> Result<(), PtyError> {
    registry.resize(id, size)
}

#[tauri::command]
#[specta::specta]
pub async fn pty_kill(registry: State<'_, Arc<Registry>>, id: PtyId) -> Result<(), PtyError> {
    registry.kill(id)
}
