import { events } from '@main/lib/events';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { ptyStartedChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import type { Pty } from './pty';

export interface PtySessionMetadata {
  providerId?: AgentProviderId;
  title?: string;
  isRemote?: boolean;
}

const FLUSH_INTERVAL_MS = 16; // ~60 fps
const RING_BUFFER_CAP = 64 * 1024; // 64 KB per session

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();
  private ringBuffers: Map<string, string> = new Map();
  private activeConsumers: Set<string> = new Set();
  private metadata: Map<string, PtySessionMetadata> = new Map();
  private lastSizes: Map<string, { cols: number; rows: number }> = new Map();
  private pendingFlushes: Map<string, () => void> = new Map();
  private epoch = 0;

  register(
    sessionId: string,
    pty: Pty,
    options?: { preserveBufferOnExit?: boolean; metadata?: PtySessionMetadata }
  ): void {
    const preserveBufferOnExit = options?.preserveBufferOnExit ?? false;

    // Clear any stale ring buffer and consumer from a previous PTY at this sessionId (respawn)
    this.ptyInputSubscriptions.get(sessionId)?.();
    this.ptyInputSubscriptions.delete(sessionId);
    this.pendingFlushes.delete(sessionId);
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
    if (options?.metadata) this.metadata.set(sessionId, options.metadata);

    this.ptyMap.set(sessionId, pty);
    this.epoch += 1;
    const epoch = this.epoch;

    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (this.ptyMap.get(sessionId) !== pty) {
        buffer = '';
        flushTimer = null;
        return;
      }
      if (buffer) {
        events.emit(ptyDataChannel, buffer, sessionId);
        buffer = '';
      }
      flushTimer = null;
    };
    this.pendingFlushes.set(sessionId, flush);

    pty.onData((data) => {
      if (this.ptyMap.get(sessionId) !== pty) return;
      buffer += data;
      if (!flushTimer) {
        flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
      // Accumulate into ring buffer for late-connecting renderers
      let rb = (this.ringBuffers.get(sessionId) ?? '') + data;
      if (rb.length > RING_BUFFER_CAP) rb = rb.slice(-RING_BUFFER_CAP);
      this.ringBuffers.set(sessionId, rb);
    });

    pty.onExit((info) => {
      const isCurrentPty = this.ptyMap.get(sessionId) === pty;
      if (!isCurrentPty) return;

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
        this.pendingFlushes.delete(sessionId);
        this.lastSizes.delete(sessionId);
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
    events.emit(ptyStartedChannel, { id: sessionId, epoch });
  }

  unregister(sessionId: string): void {
    this.pendingFlushes.get(sessionId)?.();
    this.ptyMap.delete(sessionId);
    this.ptyInputSubscriptions.get(sessionId)?.();
    this.ptyInputSubscriptions.delete(sessionId);
    this.pendingFlushes.delete(sessionId);
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
    this.lastSizes.delete(sessionId);
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

  getMetadata(sessionId: string): PtySessionMetadata | undefined {
    return this.metadata.get(sessionId);
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const pty = this.ptyMap.get(sessionId);
    if (!pty) return false;
    this.lastSizes.set(sessionId, { cols, rows });
    pty.resize(cols, rows);
    return true;
  }

  getLastSize(sessionId: string): { cols: number; rows: number } | undefined {
    return this.lastSizes.get(sessionId);
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
