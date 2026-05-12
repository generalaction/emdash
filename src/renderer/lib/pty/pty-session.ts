import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { FrontendPty, prefetchTerminalSettings } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(readonly sessionId: string) {
    makeAutoObservable(this, {
      pty: false,
    });
    // Safety net: auto-connect the first time any observer reads status.
    // Eager connect in manager store load() is the primary path; this covers edge cases.
    onBecomeObserved(this, 'status', () => {
      if (this.disposed) return;
      if (this.status === 'disconnected') void this.connect();
    });
  }

  async connect() {
    if (this.disposed) return;
    if (this.pty) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectOnce() {
    runInAction(() => {
      this.status = 'connecting';
    });
    try {
      await prefetchTerminalSettings();
      if (this.disposed) return;
      const pty = new FrontendPty(this.sessionId);
      this.pty = pty;
      await pty.connect();
      if (this.disposed) {
        // dispose() ran during pty.connect() — it already nulled this.pty but
        // can't see the local `pty`, so tear it down here.
        pty.dispose();
        this.pty = null;
        return;
      }
      runInAction(() => {
        this.status = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        this.status = 'disconnected';
      });
      throw error;
    }
  }

  dispose() {
    this.disposed = true;
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }
}
