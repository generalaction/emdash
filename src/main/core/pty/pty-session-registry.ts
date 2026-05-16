import type { AgentProviderId } from '@shared/agent-provider-registry';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { events } from '@main/lib/events';
import type { Pty } from './pty';

export interface PtySessionMetadata {
  providerId?: AgentProviderId;
  title?: string;
}

const FLUSH_INTERVAL_MS = 16; // ~60 fps
const RING_BUFFER_CAP = 64 * 1024; // 64 KB per session

export type PtyDataListener = (delta: string) => void;

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();
  private ringBuffers: Map<string, string> = new Map();
  private activeConsumers: Set<string> = new Set();
  private metadata: Map<string, PtySessionMetadata> = new Map();
  // In-process data listeners (e.g. MCP resource subscriptions). Distinct
  // from `activeConsumers` (renderer IPC) — listeners fire on every PTY data
  // chunk and never affect consumer-count accounting.
  private dataListeners: Map<string, Set<PtyDataListener>> = new Map();

  register(
    sessionId: string,
    pty: Pty,
    options?: { preserveBufferOnExit?: boolean; metadata?: PtySessionMetadata }
  ): void {
    const preserveBufferOnExit = options?.preserveBufferOnExit ?? false;

    // Clear any stale ring buffer and consumer from a previous PTY at this sessionId (respawn)
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
    // Don't clear `dataListeners` — a long-lived MCP resource subscription
    // for this sessionId should keep working across respawns.
    if (options?.metadata) this.metadata.set(sessionId, options.metadata);

    this.ptyMap.set(sessionId, pty);

    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        events.emit(ptyDataChannel, buffer, sessionId);
        buffer = '';
      }
      flushTimer = null;
    };

    pty.onData((data) => {
      buffer += data;
      if (!flushTimer) {
        flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
      // Accumulate into ring buffer for late-connecting renderers
      let rb = (this.ringBuffers.get(sessionId) ?? '') + data;
      if (rb.length > RING_BUFFER_CAP) rb = rb.slice(-RING_BUFFER_CAP);
      this.ringBuffers.set(sessionId, rb);
      // Fan out to in-process listeners (MCP resource subscriptions, etc).
      const listeners = this.dataListeners.get(sessionId);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(data);
          } catch {
            // Swallow — a misbehaving listener must not break PTY plumbing.
          }
        }
      }
    });

    pty.onExit((info) => {
      // Flush any buffered output before emitting exit
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flush();
      }
      events.emit(ptyExitChannel, info, sessionId);
      if (preserveBufferOnExit) {
        // Partial cleanup: keep ring buffer so late-connecting renderers can replay output
        this.ptyMap.delete(sessionId);
        this.ptyInputSubscriptions.get(sessionId)?.();
        this.ptyInputSubscriptions.delete(sessionId);
      } else {
        this.unregister(sessionId);
      }
    });

    const off = events.on(
      ptyInputChannel,
      (data) => {
        pty.write(data);
      },
      sessionId
    );

    this.ptyInputSubscriptions.set(sessionId, off);
  }

  unregister(sessionId: string): void {
    this.ptyMap.delete(sessionId);
    this.ptyInputSubscriptions.get(sessionId)?.();
    this.ptyInputSubscriptions.delete(sessionId);
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
    this.dataListeners.delete(sessionId);
  }

  /**
   * Snapshot the ring buffer without registering an IPC consumer. Use this
   * from in-process readers (MCP tools / resources) that must not affect
   * renderer consumer-count accounting.
   */
  peek(sessionId: string): string {
    return this.ringBuffers.get(sessionId) ?? '';
  }

  /**
   * Subscribe to in-process PTY data deltas for a session. The listener is
   * invoked with the raw chunk for every `pty.onData` event. Returns an
   * unsubscribe function. Does NOT touch `activeConsumers` — that set is
   * reserved for renderer IPC delivery.
   */
  onData(sessionId: string, listener: PtyDataListener): () => void {
    let listeners = this.dataListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.dataListeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.dataListeners.get(sessionId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.dataListeners.delete(sessionId);
    };
  }

  get(sessionId: string): Pty | undefined {
    return this.ptyMap.get(sessionId);
  }

  /**
   * Atomically snapshot the ring buffer and register a consumer for future
   * IPC delivery. Returns the current ring buffer without deleting it.
   * Safe: runs in one synchronous tick — no PTY data can arrive between
   * snapshot and consumer registration.
   */
  subscribe(sessionId: string): string {
    const buf = this.ringBuffers.get(sessionId) ?? '';
    this.activeConsumers.add(sessionId);
    return buf;
  }

  /**
   * Remove the consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe(sessionId: string): void {
    this.activeConsumers.delete(sessionId);
  }

  /** Active PTYs with local OS PID; SSH entries have `pid: undefined`. */
  listActiveSessions(): Array<{
    sessionId: string;
    pid: number | undefined;
    metadata?: PtySessionMetadata;
  }> {
    const out: Array<{
      sessionId: string;
      pid: number | undefined;
      metadata?: PtySessionMetadata;
    }> = [];
    for (const [sessionId, pty] of this.ptyMap) {
      out.push({
        sessionId,
        pid: pty.getPid?.(),
        metadata: this.metadata.get(sessionId),
      });
    }
    return out;
  }
}

export const ptySessionRegistry = new PtySessionRegistry();
