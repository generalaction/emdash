import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { events } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { ptyStartedChannel } from '@shared/events/appEvents';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export type PtySessionOptions = {
  clearOnBackendStart?: boolean;
};

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private version = 0;
  private hasSeenBackendStart = false;
  private offPtyStarted: (() => void) | null = null;
  private readonly clearOnBackendStart: boolean;

  constructor(
    readonly sessionId: string,
    private readonly prepare?: () => Promise<void>,
    private readonly onOpenFile?: (filePath: string) => void,
    private readonly onOpenExternal?: (filePath: string) => void,
    options: PtySessionOptions = {}
  ) {
    this.clearOnBackendStart = options.clearOnBackendStart ?? false;
    makeAutoObservable(this, {
      pty: false,
    });
    this.offPtyStarted = events.on(ptyStartedChannel, (event) => {
      if (event.id !== this.sessionId) return;
      this.handleBackendStarted();
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
      runInAction(() => {
        this.pty = pty;
        this.status = 'connecting';
      });
      await pty.connect();
      if (version !== this.version || this.pty !== pty) return;
      this.hasSeenBackendStart = true;
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
    this.hasSeenBackendStart = false;
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

  private handleBackendStarted(): void {
    if (!this.hasSeenBackendStart) {
      this.hasSeenBackendStart = true;
      return;
    }

    if (this.clearOnBackendStart) this.pty?.clear();
  }
}
