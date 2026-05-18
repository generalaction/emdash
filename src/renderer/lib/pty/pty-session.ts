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
    // Lazy connect: auto-connects the first time any observer reads status.
    // Sessions are created at data-load time without connecting; this fires
    // when the session is first rendered as the active conversation or terminal.
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
      await pty.connect();
      if (this.disposed) {
        // dispose() ran while the local PTY was connecting and could not see it.
        pty.dispose();
        return;
      }
      runInAction(() => {
        this.pty = pty;
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
