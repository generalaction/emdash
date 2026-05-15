//! One PTY session: master/slave/child + blocking reader thread + async
//! coalescer task.
//!
//! Field declaration order encodes drop order (Rust drops fields
//! top-to-bottom). The wezterm ConPTY layer requires `MasterPty` to
//! outlive `SlavePty` on Windows (wezterm#4206 family of issues); we
//! make this invariant structural by declaring `master` last.

use parking_lot::Mutex;
use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize as PortablePtySize, SlavePty,
};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::pty::coalesce::run_coalescer;
use crate::pty::types::{PtyError, PtyId, PtySize, SpawnOptions};

/// One PTY plus its plumbing. Drop order (top-to-bottom):
///   1. `child`   — best-effort kill in `Drop`; field drop reaps the handle
///   2. `writer`  — closes the master write end
///   3. `_coalescer_handle` / `_reader_handle` — detach (cleanup is implicit)
///   4. `_slave`  — released before master
///   5. `master`  — dropped LAST (Windows invariant)
pub struct Session {
    pub id: PtyId,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    _coalescer_handle: JoinHandle<()>,
    _reader_handle: JoinHandle<()>,
    _slave: Box<dyn SlavePty + Send>,
    master: Mutex<Box<dyn MasterPty + Send>>,
}

impl Session {
    pub fn spawn<F>(id: PtyId, opts: SpawnOptions, on_flush: F) -> Result<Session, PtyError>
    where
        F: Fn(Vec<u8>) + Send + 'static,
    {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PortablePtySize {
                rows: opts.size.rows,
                cols: opts.size.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::SpawnFailed { message: e.to_string() })?;

        let mut cmd = CommandBuilder::new(&opts.command);
        for arg in &opts.args {
            cmd.arg(arg);
        }
        if let Some(cwd) = &opts.cwd {
            cmd.cwd(cwd);
        }
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed { message: e.to_string() })?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Io { message: e.to_string() })?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Io { message: e.to_string() })?;

        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);

        let reader_handle = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut reader, &mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            // Dropping tx closes the channel; coalescer drains and exits.
        });

        let coalescer_handle = tokio::spawn(run_coalescer(rx, on_flush));

        Ok(Session {
            id,
            child: Mutex::new(child),
            writer: Mutex::new(writer),
            _coalescer_handle: coalescer_handle,
            _reader_handle: reader_handle,
            _slave: pair.slave,
            master: Mutex::new(pair.master),
        })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // Best-effort kill — the field-order discipline does the rest.
        // `child.kill()` is harmless if the process already exited.
        let _ = self.child.lock().kill();
    }
}
