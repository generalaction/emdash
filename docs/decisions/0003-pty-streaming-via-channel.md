# 3. PTY streaming via `tauri::ipc::Channel<Vec<u8>>` with sender-side coalescing

Date: 2026-05-15

## Status

Accepted (EMD-8).

## Context

The PTY foundation (EMD-8) needs to forward shell output from a Rust-side
`portable_pty::MasterPty::try_clone_reader()` (a blocking `std::io::Read`)
to xterm.js in the renderer at terminal speed. Two transport options:

1. **`AppHandle::emit`** — the general-purpose event system. Encodes
   `Vec<u8>` as a JSON array of integers under
   [tauri#13405](https://github.com/tauri-apps/tauri/issues/13405) — ~3.5×
   payload bloat and a single-digit-MB/sec ceiling on the renderer side.
2. **`tauri::ipc::Channel<Vec<u8>>`** — per-invocation streaming channel.
   Tauri 2 routes `Vec<u8>` payloads ≥ 1024 bytes through the raw-fetch
   transport (no JSON-array encoding); payloads < 1024 bytes still take
   the eval/JSON path. Fire-and-forget (no backpressure signal).

The PTY also needs to bridge a **blocking** reader to an **async** sink.
The portable-pty reader cannot run on a Tokio worker; it must live on
`tokio::task::spawn_blocking`.

Some workloads (a dozen+ concurrent agent terminals) will multiplex many
PTYs through this transport.

## Decision

### 1. Output streams use `Channel<Vec<u8>>`, not the event bus

Each `pty_spawn` invocation passes its own channel; output flows only to
that invocation's subscriber. This avoids fan-out over the event bus and
keeps output delivery scoped to exactly the caller that requested the
session.

### 2. State mutations stay on the `UiMutationEvent` bridge (EMD-7)

PTY output is *not* state — it's a per-call stream. The two transports
coexist; channel messages never carry state transitions and the event bus
never carries raw bytes.

### 3. One blocking reader thread per PTY on `spawn_blocking`

`tokio::task::spawn_blocking` is the supported bridge between
`Box<dyn std::io::Read + Send>` and async Tokio. The reader thread drains
the PTY master and forwards `Vec<u8>` chunks through a
`tokio::mpsc::channel::<Vec<u8>>(64)` to an async coalescer task.

### 4. Sender-side coalescing: 16 KiB or 4 ms, whichever fires first

16 KiB keeps every flush above Tauri's 1024-byte raw-fetch threshold, so
the per-flush JSON-array overhead never applies. 4 ms is sub-frame at
60 fps for keystroke echo. The 4 ms deadline anchors to the **last** byte
received (not the first), so a sustained trickle does not flush
prematurely. Both values are starting points, not derived optima —
validation lives in the EMD load-test issue.

### 5. Channel send is fire-and-forget

No retry, no backpressure, no queueing on send failure. Under saturation
we accept message loss in exchange for a simpler architecture. The
load-test issue characterizes the breakpoint.

### 6. Drop order is structurally encoded in `Session` field declarations

Field order: `child → writer → coalescer_handle → reader_handle →
slave → master`. `MasterPty` drops last, mitigating the wezterm
Windows ConPTY family of crashes (wezterm#4206). The discipline is
enforced by a comment-block at the field declarations rather than by the
type system.

### 7. macOS hardened-runtime entitlements are not required

`allow-unsigned-executable-memory` and `disable-library-validation` cover
JIT and in-process dylib loading respectively — neither applies to
spawning a separate shell process. The Electron app ships them because V8
is JIT'd inside Electron itself. Apple docs are the authority; we do not
copy them mechanically.

### 8. `PtyId` is `u32`, not `u64`

Specta forbids `u64` export to TypeScript because JS `number` loses
precision above 2^53. `u32` (max ~4.3B) is comfortably within JS
safe-integer range and sufficient for the lifetime of a single process.

## Consequences

**Positive:**

- Stream throughput is bounded by IPC, not by JSON encoding.
- Domain code (`crate::pty`) stays free of `tauri::*` — testable without
  the runtime, enforced by `tests/domain_boundaries.rs`.
- Field-order drop discipline gives a single point of audit for the
  Windows ConPTY invariant.

**Negative:**

- Message loss is possible under sustained saturation. Accepted; the
  load-test will quantify it.
- The < 1024 byte slow path applies to idle-typing flushes (a 4 ms
  deadline can produce sub-1 KiB output). Considered acceptable since the
  keystroke echo rate is low; if it shows up in profiling, we extend the
  deadline when buffered < 1024 bytes.
- The drop-order discipline is invisible in the public API — a future
  refactor that reorders the `Session` fields can silently break Windows.
  Mitigated by the comment-block at the field declarations.

**Triggers to revisit:**

- Load-test results suggest 4 ms / 16 KiB tuning is off (latency spikes
  or throughput ceiling).
- A backpressure mechanism becomes necessary (e.g., renderer signals
  saturation).
- `portable-pty` gains async support, removing the need for
  `spawn_blocking`.

## Alternatives considered

- **Use `emit` with binary attachment proposal in tauri#13405.** Rejected:
  the proposal isn't merged and `Channel` already solves the problem for
  per-invocation streams.
- **Per-PTY async reader via `tokio::fs::File::from_std` adapter.**
  Rejected: `portable-pty` reader is `Box<dyn std::io::Read + Send>`,
  not a file descriptor we can pass to `AsyncFd`. `spawn_blocking` is
  the supported bridge.
- **Larger coalescing buckets (64 KiB).** Deferred: marginally lower
  per-flush overhead, marginally higher keystroke latency. Wait for the
  load test before tuning.

## Pointers

- `src-tauri/src/pty/session.rs` — drop-order discipline lives here.
- `src-tauri/src/pty/coalesce.rs` — `FLUSH_BYTES` / `FLUSH_INTERVAL`.
- `src-tauri/src/commands/pty.rs` — Channel sink (the only place
  `tauri::ipc::Channel` is referenced).
- `src-tauri/tests/pty_session.rs` — Unix integration coverage.

## Known follow-ups (not blocking)

- **Terminal disposal:** `Terminal` instance in the DebugShell component
  is not disposed on component unmount or after `killShell()`. Acceptable
  for dev-only use but worth tightening with a `useEffect` cleanup before
  any production-facing surface uses this code path.
- **`Registry::drain()` blocks the main thread** during window close while
  killing every session. Acceptable for a developer-tool fleet of
  sessions; revisit if real workloads ever exceed dozens.
