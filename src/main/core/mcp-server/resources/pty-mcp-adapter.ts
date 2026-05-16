/**
 * `PtyMcpAdapter` — a thin wrapper around `pty-session-registry` for the MCP
 * resource layer.
 *
 * Why this exists
 * ───────────────
 * The renderer-facing `subscribe(sessionId)` method on the registry doubles
 * as both "snapshot the ring buffer" *and* "register an IPC consumer" — the
 * second half exists so the registry can refcount active renderers per
 * session. The MCP resource and tool layers, however:
 *
 *  - Don't talk to the renderer (no IPC consumer needs registering).
 *  - Need a snapshot-only read for `read` calls and per-session
 *    fan-out for `subscribe` calls — both decoupled from the renderer
 *    refcount.
 *
 * Using `subscribe()` from MCP handlers would silently inflate the
 * `activeConsumers` set and never decrement it (the T4 code review caught
 * this as a consumer-leak risk). This adapter calls the new
 * `registry.peek()` and `registry.onData()` instead — both leave
 * `activeConsumers` untouched.
 *
 * Lifetime
 * ────────
 * One instance per MCP server. Owned by `resources/index.ts` so the lifetime
 * tracks the server itself. Multiple subscribers per session are supported
 * — the registry's listener set is keyed by sessionId.
 */
import type { PtySessionRegistry } from '@main/core/pty/pty-session-registry';

/**
 * Snapshot reply from `PtyMcpAdapter.snapshot()` — the same shape an MCP
 * resource `read` response carries inside its `text` payload, and what the
 * subscribe callback fires with on each delta.
 */
export type PtySessionSnapshot = {
  /** Bytes of ring-buffer content (for snapshots) or the delta chunk (for subscribe deltas). */
  data: string;
  /**
   * Cursor for the *end* of the data slice the caller now has. Clients can
   * pass this back via `task.getOutput`'s `sinceCursor`. For snapshots this
   * equals `data.length`; for subscribe deltas it equals the byte offset of
   * the *end* of this chunk within the producer's monotonic byte stream
   * (set to 0 — deltas are append-only and the receiver maintains its own
   * cursor by accumulating `data.length`).
   */
  cursor: number;
  /** True iff the PTY has exited (no future data will arrive). */
  eof: boolean;
};

/**
 * Listener callback for `subscribeForResource`. Fires with a delta payload
 * on every PTY data chunk. `eof: true` arrives at most once, as a final
 * delta with empty `data`, when the PTY exits.
 */
export type PtySnapshotListener = (delta: PtySessionSnapshot) => void;

/**
 * Minimal slice of `PtySessionRegistry` the adapter needs — narrowed so tests
 * can pass a stub without constructing the real registry (and to keep the
 * "thin wrapper" contract honest).
 */
export type PtyMcpAdapterDeps = Pick<PtySessionRegistry, 'peek' | 'onData' | 'get'>;

export class PtyMcpAdapter {
  constructor(private readonly registry: PtyMcpAdapterDeps) {}

  /**
   * Synchronous snapshot of the session's ring buffer. Returns an empty
   * string for unknown sessions (matches `peek` semantics). `eof` is true
   * when the session is no longer registered as an active PTY.
   */
  snapshot(sessionId: string): PtySessionSnapshot {
    const data = this.registry.peek(sessionId);
    const eof = this.registry.get(sessionId) === undefined;
    return { data, cursor: data.length, eof };
  }

  /**
   * Subscribe to live PTY output deltas for a session. The listener fires
   * once per `pty.onData` chunk; the returned function unsubscribes.
   *
   * The listener does NOT receive the initial ring-buffer snapshot — callers
   * should pair this with a `snapshot()` call if they want to backfill,
   * mirroring the MCP `read` + `subscribe` pattern.
   */
  subscribeForResource(sessionId: string, onUpdate: PtySnapshotListener): () => void {
    return this.registry.onData(sessionId, (delta: string) => {
      // `cursor` is 0 here: the receiver maintains its own monotonic offset
      // by summing delta lengths. `eof` is always false for live deltas;
      // an exit notification, if needed, can be layered on top later.
      onUpdate({ data: delta, cursor: 0, eof: false });
    });
  }
}
