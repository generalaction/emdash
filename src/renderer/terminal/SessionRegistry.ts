import {
  TerminalSessionManager,
  type SessionTheme,
  type TerminalSessionOptions,
} from './TerminalSessionManager';

const DEFAULT_SCROLLBACK_LINES = 100_000;

interface AttachOptions {
  taskId: string;
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

  detach(taskId: string) {
    this.sessions.get(taskId)?.detach();
  }

  dispose(taskId: string) {
    const session = this.sessions.get(taskId);
    if (!session) return;
    session.dispose();
    this.sessions.delete(taskId);
  }

  getSession(taskId: string): TerminalSessionManager | undefined {
    return this.sessions.get(taskId);
  }

  disposeAll() {
    for (const id of Array.from(this.sessions.keys())) {
      this.dispose(id);
    }
  }

  private getOrCreate(options: AttachOptions): TerminalSessionManager {
    const existing = this.sessions.get(options.taskId);
    if (existing) return existing;

    const sessionOptions: TerminalSessionOptions = {
      taskId: options.taskId,
      cwd: options.cwd,
      shell: options.shell,
      env: options.env,
      initialSize: options.initialSize,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      theme: options.theme,
      telemetry: null,
      autoApprove: options.autoApprove,
      initialPrompt: options.initialPrompt,
    };

    const session = new TerminalSessionManager(sessionOptions);
    this.sessions.set(options.taskId, session);
    return session;
  }
}

export const terminalSessionRegistry = new SessionRegistry();
