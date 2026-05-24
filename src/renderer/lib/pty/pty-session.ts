import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import { FrontendPty } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';

  constructor(
    readonly sessionId: string,
    private readonly onOpenFile?: (filePath: string) => void,
    private readonly onOpenExternal?: (filePath: string) => void
  ) {
    makeAutoObservable(this, {
      pty: false,
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
    this.pty = new FrontendPty(this.sessionId, undefined, this.onOpenFile, this.onOpenExternal);
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
