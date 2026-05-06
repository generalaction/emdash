import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { events } from '@main/lib/events';
import type { Pty } from './pty';

const FLUSH_INTERVAL_MS = 16; // ~60 fps
const RING_BUFFER_CAP = 64 * 1024; // 64 KB per session

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();
  private ringBuffers: Map<string, string> = new Map();
  private activeConsumers: Set<string> = new Set();

  register(sessionId: string, pty: Pty, options?: { preserveBufferOnExit?: boolean }): void {
    const preserveBufferOnExit = options?.preserveBufferOnExit ?? false;

    // Clear any stale ring buffer and consumer from a previous PTY at this sessionId (respawn)
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);

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
}

export const ptySessionRegistry = new PtySessionRegistry();
