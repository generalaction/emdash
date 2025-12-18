import {
  TerminalSessionManager,
  type SessionTheme,
  type TerminalSessionOptions,
} from './TerminalSessionManager';

const DEFAULT_SCROLLBACK_LINES = 100_000;

interface AttachOptions {
  workspaceId: string;
  container: HTMLElement;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  initialSize: { cols: number; rows: number };
  theme: SessionTheme;
  autoApprove?: boolean;
  initialPrompt?: string;
}

class SessionRegistry {
  private readonly sessions = new Map<string, TerminalSessionManager>();

  attach(options: AttachOptions): TerminalSessionManager {
    const session = this.getOrCreate(options);
    session.setTheme(options.theme);
    session.attach(options.container);
    return session;
  }

  detach(workspaceId: string) {
    this.sessions.get(workspaceId)?.detach();
  }

  dispose(workspaceId: string) {
    const session = this.sessions.get(workspaceId);
    if (!session) return;
    session.dispose();
    this.sessions.delete(workspaceId);
  }

  getSession(workspaceId: string): TerminalSessionManager | undefined {
    return this.sessions.get(workspaceId);
  }

  disposeAll() {
    for (const id of Array.from(this.sessions.keys())) {
      this.dispose(id);
    }
  }

  private getOrCreate(options: AttachOptions): TerminalSessionManager {
    const existing = this.sessions.get(options.workspaceId);
    if (existing) return existing;

    const sessionOptions: TerminalSessionOptions = {
      workspaceId: options.workspaceId,
      cwd: options.cwd,
      shell: options.shell,
      env: options.env,
      initialSize: options.initialSize,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      theme: options.theme,
      telemetry: null,
      autoApprove: options.autoApprove,
      initialPrompt: options.initialPrompt,
      // Let ptyIpc decide whether to skip resume based on snapshot existence
      // Don't force skipResume here - the IPC layer handles this intelligently
    };

    const session = new TerminalSessionManager(sessionOptions);
    this.sessions.set(options.workspaceId, session);
    return session;
  }
}

export const terminalSessionRegistry = new SessionRegistry();
