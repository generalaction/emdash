import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { events } from '@main/lib/events';
import type { Pty } from './pty';

const FLUSH_INTERVAL_MS = 16; // ~60 fps

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();

  register(sessionId: string, pty: Pty): void {
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
}

export const ptySessionRegistry = new PtySessionRegistry();
