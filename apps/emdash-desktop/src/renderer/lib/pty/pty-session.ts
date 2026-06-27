import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { events } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { ptyStartedChannel } from '@shared/events/appEvents';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';
type WindowsPtyBackend = 'conpty' | undefined;

export type PtySessionOptions = {
  clearOnBackendStart?: boolean;
  isRemote?: boolean | (() => boolean);
};

function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
}

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private version = 0;
  private hasSeenBackendStart = false;
  private offPtyStarted: (() => void) | null = null;
  private windowsPtyBackend: WindowsPtyBackend;
  private readonly clearOnBackendStart: boolean;
  private readonly isRemote: () => boolean;

  constructor(
    readonly sessionId: string,
    private readonly prepare?: () => Promise<void>,
    private readonly onOpenFile?: (filePath: string) => void,
    private readonly onOpenExternal?: (filePath: string) => void,
    options: PtySessionOptions = {}
  ) {
    this.clearOnBackendStart = options.clearOnBackendStart ?? false;
    this.isRemote =
      typeof options.isRemote === 'function' ? options.isRemote : () => options.isRemote === true;
    this.windowsPtyBackend = this.getWindowsPtyBackend();
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
      const windowsPtyBackend = this.getWindowsPtyBackend();
      this.windowsPtyBackend = windowsPtyBackend;
      const pty = new FrontendPty(this.sessionId, undefined, this.onOpenFile, this.onOpenExternal, {
        windowsPtyBackend,
      });
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

  refreshWindowsPtyBackend(): void {
    const windowsPtyBackend = this.getWindowsPtyBackend();
    if (windowsPtyBackend === this.windowsPtyBackend) return;

    this.windowsPtyBackend = windowsPtyBackend;
    if (!this.pty && !this.connectPromise) return;

    this.version++;
    const reconnectVersion = this.version;
    const reconnectAfterCurrentConnect = this.connectPromise;
    this.pty?.dispose();
    this.hasSeenBackendStart = false;
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });

    if (reconnectAfterCurrentConnect) {
      void reconnectAfterCurrentConnect
        .finally(() => {
          if (this.version === reconnectVersion && this.status === 'disconnected') {
            void this.connect();
          }
        })
        .catch(() => {});
    } else {
      void this.connect();
    }
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
    if (this.status !== 'ready') return;

    if (!this.hasSeenBackendStart) {
      this.hasSeenBackendStart = true;
      return;
    }

    if (this.clearOnBackendStart) this.pty?.clear();
  }

  private getWindowsPtyBackend(): WindowsPtyBackend {
    return isWindowsPlatform() && !this.isRemote() ? 'conpty' : undefined;
  }
}
