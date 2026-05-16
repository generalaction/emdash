/**
 * In-memory ring buffer of recent MCP tool invocations (target capacity: 200).
 *
 * Eventual responsibilities:
 * - `record(call)`: append `{ tool, ms, status, error? }` entries, evicting
 *   the oldest when capacity is reached.
 * - `snapshot()`: return a chronological copy for the Settings UI to render.
 *
 * Currently a stub — both methods are no-ops.
 */
export class RecentCallsRing {
  record(): void {}

  snapshot(): unknown {
    return [];
  }
}
