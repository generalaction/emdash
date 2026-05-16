/**
 * In-memory ring buffer of recent MCP tool invocations (target capacity: 200).
 *
 * Eventual responsibilities:
 * - `record(call)`: append `{ tool, ms, status, error? }` entries, evicting
 *   the oldest when capacity is reached.
 * - `snapshot()`: return a chronological copy for the Settings UI to render.
 *
 * Currently a stub — `record` is a no-op and `snapshot` returns an empty
 * array. T7 fills in the actual storage. The signature is finalised here so
 * tool handlers can wire `withRecording()` against the right shape today.
 */

export type RecentCallStatus = 'ok' | 'error';

export interface RecentCallEntry {
  tool: string;
  ms: number;
  status: RecentCallStatus;
  error?: string;
}

export class RecentCallsRing {
  record(_entry: RecentCallEntry): void {}

  snapshot(): RecentCallEntry[] {
    return [];
  }
}

export const recentCallsRing = new RecentCallsRing();
