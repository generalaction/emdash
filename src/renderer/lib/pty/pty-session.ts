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
      // dispose() may have been called while prefetch was pending. Without this
      // guard we would resurrect the session: dispose() has nothing to clean up
      // because this.pty is still null, then we'd build a fresh FrontendPty and
      // mark the disposed session 'ready', leaking xterm + IPC subscriptions.
      if (this.disposed) return;
      if (this.pty) return;
      const pty = new FrontendPty(this.sessionId);
      this.pty = pty;
      await pty.connect();
      // Re-check after connect() — dispose() during the await would have set
      // this.pty back to null but cannot reach the local `pty` we just created.
      if (this.disposed) {
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
