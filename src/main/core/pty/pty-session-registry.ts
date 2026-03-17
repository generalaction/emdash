import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { events } from '@main/lib/events';
import type { Pty } from './pty';

const FLUSH_INTERVAL_MS = 16; // ~60 fps
const RING_BUFFER_CAP = 64 * 1024; // 64 KB per session

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();
  private ringBuffers: Map<string, string> = new Map();

  register(sessionId: string, pty: Pty): void {
    // Clear any stale ring buffer from a previous PTY at this sessionId (respawn)
    this.ringBuffers.delete(sessionId);

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
      this.unregister(sessionId);
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
  }

  get(sessionId: string): Pty | undefined {
    return this.ptyMap.get(sessionId);
  }

  /**
   * Return and delete the accumulated ring buffer for a session.
   * Called once by the renderer on FrontendPty construction to catch up on
   * output that was emitted before the renderer subscribed.
   */
  getBuffer(sessionId: string): string {
    const buf = this.ringBuffers.get(sessionId) ?? '';
    this.ringBuffers.delete(sessionId);
    return buf;
  }
}

export const ptySessionRegistry = new PtySessionRegistry();
