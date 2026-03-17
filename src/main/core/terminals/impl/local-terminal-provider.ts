import { makePtySessionId } from '@shared/ptySessionId';
import { Terminal } from '@shared/terminals';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { log } from '@main/lib/logger';
import { TerminalProvider } from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class LocalTerminalProvider implements TerminalProvider {
  private sessions = new Map<string, Pty>();
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;

  constructor({
    projectId,
    taskId,
    taskPath,
  }: {
    projectId: string;
    taskId: string;
    taskPath: string;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.taskPath = taskPath;
  }

  async spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    command?: { command: string; args: string[] }
  ): Promise<void> {
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);

    const userShell =
      process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    const pty = spawnLocalPty({
      id: sessionId,
      command: command?.command ?? userShell,
      // -l: login shell — sources /etc/profile, ~/.zprofile, ~/.bash_profile,
      // etc., giving the user the same environment as any other terminal app.
      // Only applied when using the default shell; explicit commands control
      // their own args.
      args: command?.args ?? (process.platform !== 'win32' ? ['-l'] : []),
      cwd: this.taskPath,
      env: buildTerminalEnv(),
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    pty.onExit(() => {
      ptySessionRegistry.unregister(sessionId);
      const shouldRespawn = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      if (shouldRespawn) {
        setTimeout(() => {
          this.spawnTerminal(terminal).catch((e) => {
            log.error('LocalTerminalProvider: respawn failed', {
              terminalId: terminal.id,
              error: String(e),
            });
          });
        }, 500);
      }
      ptySessionRegistry.register(sessionId, pty);
    });

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, terminalId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
  }

  async destroyAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
