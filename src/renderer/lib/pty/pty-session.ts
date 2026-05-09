import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { FrontendPty } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';

  constructor(readonly sessionId: string) {
    makeAutoObservable(this, {
      pty: false,
    });
    // Safety net: auto-connect the first time any observer reads status.
    // Eager connect in manager store load() is the primary path; this covers edge cases.
    onBecomeObserved(this, 'status', () => {
      if (this.status === 'disconnected') void this.connect();
    });
  }

  async connect() {
    if (this.pty) return;
    this.pty = new FrontendPty(this.sessionId);
    runInAction(() => {
      this.status = 'connecting';
    });
    await this.pty.connect();
    runInAction(() => {
      this.status = 'ready';
    });
  }

  dispose() {
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }
}
