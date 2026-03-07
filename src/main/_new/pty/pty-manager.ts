import { events } from '../events';
import type { Pty } from './core';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';

const FLUSH_INTERVAL_MS = 16; // ~60 fps

export class PtyManager {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();

  addPty(id: string, pty: Pty): void {
    this.ptyMap.set(id, pty);

    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        events.emit(ptyDataChannel, buffer, id);
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
      events.emit(ptyExitChannel, info, id);
      this.removePty(id);
    });

    const off = events.on(
      ptyInputChannel,
      (data) => {
        pty.write(data);
      },
      id
    );

    this.ptyInputSubscriptions.set(id, off);
  }

  removePty(id: string): void {
    this.ptyMap.delete(id);
    this.ptyInputSubscriptions.get(id)?.();
    this.ptyInputSubscriptions.delete(id);
  }

  getPty(id: string): Pty | undefined {
    return this.ptyMap.get(id);
  }
}

export const ptyManager = new PtyManager();
