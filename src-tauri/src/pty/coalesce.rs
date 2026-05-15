//! Sender-side coalescing: flush on whichever fires first — 16 KiB
//! buffered or 4 ms since the last byte. Domain-side; sink is a generic
//! `Fn(Vec<u8>) + Send` so it stays free of `tauri::ipc::Channel`.

use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time;

pub const FLUSH_BYTES: usize = 16 * 1024;
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(4);

/// Drains `rx` and forwards bytes to `on_flush` in coalesced chunks. Exits
/// when all `Sender`s are dropped, after flushing any remaining bytes.
pub async fn run_coalescer<F>(mut rx: mpsc::Receiver<Vec<u8>>, on_flush: F)
where
    F: Fn(Vec<u8>) + Send,
{
    let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);
    let mut deadline: Option<time::Instant> = None;

    loop {
        if let Some(d) = deadline {
            tokio::select! {
                biased;
                msg = rx.recv() => match msg {
                    Some(chunk) => {
                        buf.extend_from_slice(&chunk);
                        if buf.len() >= FLUSH_BYTES {
                            on_flush(std::mem::take(&mut buf));
                            buf.reserve(FLUSH_BYTES);
                            deadline = None;
                        }
                    }
                    None => break,
                },
                _ = time::sleep_until(d) => {
                    if !buf.is_empty() {
                        on_flush(std::mem::take(&mut buf));
                        buf.reserve(FLUSH_BYTES);
                    }
                    deadline = None;
                }
            }
        } else {
            match rx.recv().await {
                Some(chunk) => {
                    buf.extend_from_slice(&chunk);
                    if buf.len() >= FLUSH_BYTES {
                        on_flush(std::mem::take(&mut buf));
                        buf.reserve(FLUSH_BYTES);
                    } else {
                        deadline = Some(time::Instant::now() + FLUSH_INTERVAL);
                    }
                }
                None => break,
            }
        }
    }
    if !buf.is_empty() {
        on_flush(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use std::sync::Arc;

    fn make_sink() -> (Arc<Mutex<Vec<Vec<u8>>>>, impl Fn(Vec<u8>) + Send + Clone) {
        let store: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = {
            let store = store.clone();
            move |bytes: Vec<u8>| store.lock().push(bytes)
        };
        (store, sink)
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn flushes_when_size_threshold_crossed() {
        let (store, sink) = make_sink();
        let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
        let h = tokio::spawn(run_coalescer(rx, sink));

        tx.send(vec![0u8; FLUSH_BYTES]).await.unwrap();
        time::sleep(Duration::from_millis(1)).await;
        assert_eq!(store.lock().len(), 1, "size-threshold flush not observed");
        assert_eq!(store.lock()[0].len(), FLUSH_BYTES);

        drop(tx);
        h.await.unwrap();
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn flushes_when_time_deadline_elapses() {
        let (store, sink) = make_sink();
        let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
        let h = tokio::spawn(run_coalescer(rx, sink));

        tx.send(vec![1, 2, 3]).await.unwrap();
        time::sleep(FLUSH_INTERVAL + Duration::from_millis(1)).await;
        assert_eq!(store.lock().len(), 1, "time-deadline flush not observed");
        assert_eq!(store.lock()[0], vec![1, 2, 3]);

        drop(tx);
        h.await.unwrap();
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn drains_remaining_bytes_on_close() {
        let (store, sink) = make_sink();
        let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
        let h = tokio::spawn(run_coalescer(rx, sink));

        tx.send(vec![9, 9]).await.unwrap();
        drop(tx);
        h.await.unwrap();

        let flushes = store.lock();
        let total: Vec<u8> = flushes.iter().flatten().copied().collect();
        assert_eq!(total, vec![9, 9], "remainder not flushed on close");
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn coalesces_multiple_small_chunks_into_one_flush() {
        let (store, sink) = make_sink();
        let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
        let h = tokio::spawn(run_coalescer(rx, sink));

        for _ in 0..4 {
            tx.send(vec![7]).await.unwrap();
        }
        time::sleep(FLUSH_INTERVAL + Duration::from_millis(1)).await;
        let flushes = store.lock().clone();
        assert_eq!(flushes.len(), 1, "expected one coalesced flush, got {:?}", flushes);
        assert_eq!(flushes[0], vec![7, 7, 7, 7]);

        drop(tx);
        h.await.unwrap();
    }
}
