//! `PtyId -> Session` map. Drained on app window-close to avoid orphan
//! shells (the Electron app leaves this implicit; we make it explicit).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use parking_lot::Mutex;

use crate::pty::session::Session;
use crate::pty::types::{PtyError, PtyId, PtySize, SpawnOptions};

pub struct Registry {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<PtyId, Session>>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn<F>(&self, opts: SpawnOptions, on_flush: F) -> Result<PtyId, PtyError>
    where
        F: Fn(Vec<u8>) + Send + 'static,
    {
        let id = PtyId(self.next_id.fetch_add(1, Ordering::Relaxed));
        let session = Session::spawn(id, opts, on_flush)?;
        self.sessions.lock().insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: PtyId, bytes: &[u8]) -> Result<(), PtyError> {
        let sessions = self.sessions.lock();
        let session = sessions.get(&id).ok_or(PtyError::NotFound { id })?;
        session.write(bytes)
    }

    pub fn resize(&self, id: PtyId, size: PtySize) -> Result<(), PtyError> {
        let sessions = self.sessions.lock();
        let session = sessions.get(&id).ok_or(PtyError::NotFound { id })?;
        session.resize(size)
    }

    pub fn kill(&self, id: PtyId) -> Result<(), PtyError> {
        let session = self
            .sessions
            .lock()
            .remove(&id)
            .ok_or(PtyError::NotFound { id })?;
        let res = session.kill();
        drop(session); // explicit drop: invokes Session::Drop before res is returned
        res
    }

    /// Drains the entire registry, dropping every session in turn. Called
    /// from app shutdown. Best-effort: errors are swallowed because there
    /// is no caller left to surface them to.
    pub fn drain(&self) {
        let mut sessions = self.sessions.lock();
        for (_, session) in sessions.drain() {
            let _ = session.kill();
            drop(session);
        }
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;

    fn cat_opts() -> SpawnOptions {
        SpawnOptions {
            command: "/bin/cat".into(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            size: PtySize { rows: 24, cols: 80 },
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn spawn_returns_monotonic_ids() {
        let r = Registry::new();
        let a = r.spawn(cat_opts(), |_| {}).unwrap();
        let b = r.spawn(cat_opts(), |_| {}).unwrap();
        assert!(b.0 > a.0, "expected monotonic ids, got {a:?} then {b:?}");
        r.drain();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_to_unknown_id_returns_not_found() {
        let r = Registry::new();
        let err = r.write(PtyId(999), b"x").unwrap_err();
        match err {
            PtyError::NotFound { id } => assert_eq!(id, PtyId(999)),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn kill_removes_session_from_registry() {
        let r = Registry::new();
        let id = r.spawn(cat_opts(), |_| {}).unwrap();
        r.kill(id).expect("kill ok");
        let err = r.kill(id).unwrap_err();
        assert!(matches!(err, PtyError::NotFound { .. }));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drain_clears_all_sessions() {
        let r = Registry::new();
        let _ = r.spawn(cat_opts(), |_| {}).unwrap();
        let _ = r.spawn(cat_opts(), |_| {}).unwrap();
        r.drain();
        assert!(r.sessions.lock().is_empty());
    }
}
