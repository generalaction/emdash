/**
 * Registers the `emdash://tasks/{id}/sessions/{sid}` resource — the PTY
 * session ring buffer + cursor.
 *
 * Eventual responsibilities:
 * - On `read`: return the current 64 KB ring-buffer snapshot from
 *   `pty-session-registry` plus a cursor.
 * - On `subscribe`: stream `update` notifications with deltas as the PTY
 *   produces output, via a `PtyMcpAdapter` wrapping the registry's event
 *   stream.
 *
 * Currently a stub — no-op.
 */
export function register(_server: unknown): void {}
