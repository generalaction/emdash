import { events } from '@/events';
import { Pty } from './core';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';

export class PtyManager {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();

  addPty(id: string, pty: Pty): void {
    this.ptyMap.set(id, pty);

    pty.onData((data) => {
      events.emit(ptyDataChannel, data);
    });

    pty.onExit((info) => {
      events.emit(ptyExitChannel, info);
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
