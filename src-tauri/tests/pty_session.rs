//! Integration tests for `pty::session`. Spawns real shells, so the
//! tests are Unix-only — Windows ConPTY behavior is verified manually
//! through the DebugShell in Task 10.

#![cfg(unix)]

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;

use emdash_dev::pty::session::Session;
use emdash_dev::pty::types::{PtyId, PtySize, SpawnOptions};

fn echo_opts() -> SpawnOptions {
    SpawnOptions {
        command: "/bin/echo".into(),
        args: vec!["hello-pty".into()],
        cwd: None,
        env: std::collections::HashMap::new(),
        size: PtySize { rows: 24, cols: 80 },
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_streams_echo_output() {
    let collected: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = {
        let collected = collected.clone();
        move |bytes: Vec<u8>| collected.lock().extend_from_slice(&bytes)
    };

    let session = Session::spawn(PtyId(1), echo_opts(), sink).expect("spawn ok");

    let saw_output = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            if String::from_utf8_lossy(&collected.lock()).contains("hello-pty") {
                return true;
            }
        }
    })
    .await
    .unwrap_or(false);

    assert!(saw_output, "did not see echo output within 5s");
    drop(session);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_drops_without_panic() {
    let session = Session::spawn(PtyId(2), echo_opts(), |_| {}).expect("spawn ok");
    drop(session);
}

fn cat_opts() -> SpawnOptions {
    SpawnOptions {
        command: "/bin/cat".into(),
        args: vec![],
        cwd: None,
        env: std::collections::HashMap::new(),
        size: PtySize { rows: 24, cols: 80 },
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_round_trips_through_cat() {
    let collected: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = {
        let collected = collected.clone();
        move |bytes: Vec<u8>| collected.lock().extend_from_slice(&bytes)
    };

    let session = Session::spawn(PtyId(3), cat_opts(), sink).expect("spawn ok");
    session.write(b"hi-cat\n").expect("write ok");

    let saw_echo = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            if String::from_utf8_lossy(&collected.lock()).contains("hi-cat") {
                return true;
            }
        }
    })
    .await
    .unwrap_or(false);

    assert!(saw_echo, "cat did not echo the input within 5s");
    session.kill().ok();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_does_not_error_on_running_session() {
    let session = Session::spawn(PtyId(4), cat_opts(), |_| {}).expect("spawn ok");
    session
        .resize(PtySize { rows: 40, cols: 132 })
        .expect("resize ok");
    session.kill().ok();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_returns_before_session_drop() {
    let session = Session::spawn(PtyId(5), cat_opts(), |_| {}).expect("spawn ok");
    session.kill().expect("kill ok");
    // Dropping after explicit kill must not panic.
    drop(session);
}
