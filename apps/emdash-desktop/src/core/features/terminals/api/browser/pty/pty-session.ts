import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import {
  FrontendPty,
  type FrontendPtyConnector,
} from '@core/features/terminals/api/browser/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

type PtySessionPrepareResult = void | false;

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private version = 0;
  private lifetime = 0;
  private connectionRequested = false;

  constructor(
    readonly sessionId: string,
    private readonly prepare?: () => Promise<PtySessionPrepareResult>,
    private readonly onOpenFile?: (filePath: string) => void,
    private readonly onOpenExternal?: (filePath: string) => void,
    private readonly connector: FrontendPtyConnector = noopConnector(),
    private readonly canConnect: () => boolean = () => true
  ) {
    makeAutoObservable(this, {
      pty: false,
    });
    // Lazy connect: auto-connects the first time any observer reads status.
    // Sessions are created at data-load time without connecting; this fires
    // when the session is first rendered as the active conversation or terminal.
    onBecomeObserved(this, 'status', () => {
      if (this.status === 'disconnected') void this.connect().catch(() => {});
    });
  }

  async connect(): Promise<void> {
    this.connectionRequested = true;
    if (!this.canConnect() || this.status === 'ready') return;
    return this.reconcile();
  }

  resumeIfRequested(): void {
    if (this.connectionRequested && this.status === 'disconnected') {
      // Failure remains observable and can be retried by the next Host wake or user action.
      void this.connect().catch(() => {});
    }
  }

  /** Request fresh reconciliation, including when an older attachment is still in flight. */
  async refreshAttachment(): Promise<void> {
    if (!this.connectionRequested || !this.canConnect()) return;
    this.version++;
    return this.reconcile();
  }

  private reconcile(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    const lifetime = this.lifetime;
    this.status = 'connecting';
    const current = () => this.lifetime === lifetime && this.connectionRequested;
    const promise = Promise.resolve()
      .then(async () => {
        while (current() && this.canConnect()) {
          const version = this.version;
          try {
            const prepared = await this.prepare?.();
            if (!current()) return;
            if (version !== this.version) continue;
            if (prepared === false || !this.canConnect()) return;
            let pty = this.pty;
            if (!pty) {
              pty = new FrontendPty(
                this.sessionId,
                undefined,
                this.onOpenFile,
                this.onOpenExternal,
                {
                  connect: (terminal) => this.connector.connect(terminal),
                  sendInput: (data) => {
                    if (this.status === 'ready' && this.canConnect())
                      this.connector.sendInput?.(data);
                  },
                  resize: (cols, rows) => {
                    if (this.canConnect()) this.connector.resize?.(cols, rows);
                  },
                }
              );
              runInAction(() => {
                this.pty = pty;
              });
            }
            await pty.connect();
            if (!current()) return;
            if (version !== this.version) continue;
            if (this.canConnect())
              runInAction(() => {
                this.status = 'ready';
              });
            return;
          } catch (error) {
            if (!current()) return;
            if (version !== this.version) continue;
            throw error;
          }
        }
      })
      .finally(() => {
        if (this.connectPromise !== promise) return;
        this.connectPromise = null;
        if (current() && this.status !== 'ready') {
          runInAction(() => {
            this.status = 'disconnected';
          });
        }
      });
    this.connectPromise = promise;
    return promise;
  }

  dispose() {
    this.version++;
    this.lifetime++;
    this.connectPromise = null;
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }

  destroy() {
    this.connectionRequested = false;
    this.dispose();
  }
}

function noopConnector(): FrontendPtyConnector {
  return {
    connect() {
      return () => {};
    },
  };
}
