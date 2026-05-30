import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { events } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { ptyStartedChannel } from '@shared/events/appEvents';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private version = 0;
  private lastSeenEpoch = 0;
  private offPtyStarted: (() => void) | null = null;

  constructor(
    readonly sessionId: string,
    private readonly prepare?: () => Promise<void>,
    private readonly onOpenFile?: (filePath: string) => void,
    private readonly onOpenExternal?: (filePath: string) => void
  ) {
    makeAutoObservable(this, {
      pty: false,
    });
    this.offPtyStarted = events.on(ptyStartedChannel, (event) => {
      if (event.id !== this.sessionId) return;
      void this.handleBackendStarted(event.epoch);
    });
    // Lazy connect: auto-connects the first time any observer reads status.
    // Sessions are created at data-load time without connecting; this fires
    // when the session is first rendered as the active conversation or terminal.
    onBecomeObserved(this, 'status', () => {
      if (this.status === 'disconnected') void this.connect();
    });
  }

  async connect() {
    if (this.pty) return;
    if (this.connectPromise) return this.connectPromise;

    const version = this.version;
    this.connectPromise = (async () => {
      await this.prepare?.();
      if (version !== this.version) return;
      if (this.pty) return;
      const pty = new FrontendPty(this.sessionId, undefined, this.onOpenFile, this.onOpenExternal);
      this.pty = pty;
      runInAction(() => {
        this.status = 'connecting';
      });
      await pty.connect();
      if (version !== this.version || this.pty !== pty) return;
      if (this.lastSeenEpoch === 0) this.lastSeenEpoch = 1;
      runInAction(() => {
        this.status = 'ready';
      });
    })().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  dispose() {
    this.version++;
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }

  destroy() {
    this.dispose();
    this.offPtyStarted?.();
    this.offPtyStarted = null;
  }

  private async handleBackendStarted(epoch: number): Promise<void> {
    if (epoch <= this.lastSeenEpoch) return;
    if (this.lastSeenEpoch === 0 && (this.status === 'connecting' || this.pty === null)) {
      this.lastSeenEpoch = epoch;
      return;
    }
    if (!this.pty && this.status === 'disconnected') {
      this.lastSeenEpoch = epoch;
      return;
    }

    this.lastSeenEpoch = epoch;
    this.version++;
    this.connectPromise = null;
    this.pty?.dispose();

    const version = this.version;
    const pty = new FrontendPty(this.sessionId, undefined, this.onOpenFile, this.onOpenExternal);
    runInAction(() => {
      this.pty = pty;
      this.status = 'connecting';
    });

    try {
      await pty.connect();
      if (version === this.version && this.pty === pty) {
        runInAction(() => {
          this.status = 'ready';
        });
      }
    } catch {
      if (version === this.version && this.pty === pty) {
        pty.dispose();
        runInAction(() => {
          this.pty = null;
          this.status = 'disconnected';
        });
      }
    }
  }
}
