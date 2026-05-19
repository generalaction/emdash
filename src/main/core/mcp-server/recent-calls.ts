/**
 * In-memory ring buffer of recent MCP tool invocations (fixed capacity: 200).
 *
 * Used by the Settings page (`mcpServer.getRecentCalls`) and surfaced live via
 * the `mcpServerRecentCallChannel` event so the renderer can append entries
 * without polling.
 *
 * The buffer is intentionally in-memory only — it resets when the app
 * restarts. Persistence is out of scope for v1 (see spec).
 */
import { randomUUID } from 'node:crypto';
import { mcpServerRecentCallChannel, type RecentCallEntry } from '@shared/events/mcpServerEvents';
import type * as MainEvents from '@main/lib/events';

export type { RecentCallEntry } from '@shared/events/mcpServerEvents';

export type RecentCallStatus = 'ok' | 'error';

/** Fixed capacity of the ring buffer. Matches the spec ("last 200 calls"). */
export const RECENT_CALLS_CAPACITY = 200;

export interface RecentCallSnapshotOptions {
  /** Max number of entries to return (most-recent first). Defaults to all. */
  limit?: number;
  /** Only entries with `ts > sinceTs`. */
  sinceTs?: number;
  /** Filter to only `'ok'` or only `'error'` entries. */
  status?: RecentCallStatus;
}

export interface RecentCallEventEmitter {
  emit: (data: RecentCallEntry) => void;
}

/**
 * The default emitter wraps the main-process `events` bus + the
 * `mcpServerRecentCallChannel` channel. The bus is required lazily on the
 * first emit so simply *constructing* the singleton ring in a test or in
 * the stdio bridge (which has no Electron context) does not transitively
 * pull in `@main/lib/events` → `electron` → `@main/db/client`.
 *
 * If the require fails (e.g. tests that exercise tool handlers without
 * setting up the Electron stubs), the emit is silently dropped — the ring
 * itself is the source of truth and the UI uses the channel only as a
 * "wake up and re-snapshot" hint.
 */
function defaultEmitter(): RecentCallEventEmitter {
  return {
    emit: (data) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod: typeof MainEvents = require('@main/lib/events');
        mod.events.emit(mcpServerRecentCallChannel, data);
      } catch {
        // ignore — see comment above defaultEmitter.
      }
    },
  };
}

/**
 * Fixed-capacity ring buffer of recent tool calls.
 *
 * The internal storage is a plain array of length `capacity`; `head` points at
 * the next write slot and wraps modulo `capacity`. `count` tracks how many
 * slots are populated (saturates at `capacity`). Reads via `snapshot()` walk
 * from newest to oldest.
 */
export class RecentCallsRing {
  private readonly buffer: Array<RecentCallEntry | null>;
  private readonly capacity: number;
  private head = 0;
  private count = 0;
  private readonly emitter: RecentCallEventEmitter;

  constructor(
    capacity: number = RECENT_CALLS_CAPACITY,
    emitter: RecentCallEventEmitter | null = null
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`RecentCallsRing capacity must be a positive integer (got ${capacity})`);
    }
    this.capacity = capacity;
    this.buffer = new Array<RecentCallEntry | null>(capacity).fill(null);
    this.emitter = emitter ?? defaultEmitter();
  }

  /**
   * Append a new call entry. Assigns a fresh `id` and `ts`, then pushes into
   * the ring (oldest entry evicted if full). Emits the entry on
   * `mcpServerRecentCallChannel` for live UI updates.
   */
  record(entry: Omit<RecentCallEntry, 'id' | 'ts'>): RecentCallEntry {
    const full: RecentCallEntry = {
      ...entry,
      id: randomUUID(),
      ts: Date.now(),
    };
    this.buffer[this.head] = full;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    try {
      this.emitter.emit(full);
    } catch {
      // Emitter failures must never break tool invocation; the ring buffer
      // itself is still updated.
    }
    return full;
  }

  /**
   * Returns entries most-recent first, optionally filtered.
   *
   * Filtering order: `status` and `sinceTs` are applied first; `limit` caps
   * the result length after filtering.
   */
  snapshot(opts: RecentCallSnapshotOptions = {}): RecentCallEntry[] {
    const out: RecentCallEntry[] = [];
    const { limit, sinceTs, status } = opts;
    for (let i = 0; i < this.count; i += 1) {
      // Walk backwards from the most-recently-written slot.
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const entry = this.buffer[idx];
      if (!entry) continue;
      if (sinceTs !== undefined && entry.ts <= sinceTs) continue;
      if (status !== undefined && entry.status !== status) continue;
      out.push(entry);
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }

  /** Drop every entry. */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.count = 0;
  }

  /** Current number of buffered entries (≤ capacity). */
  size(): number {
    return this.count;
  }
}

/** Singleton used by `withRecording()` and the RPC controller. */
export const recentCallsRing = new RecentCallsRing();
