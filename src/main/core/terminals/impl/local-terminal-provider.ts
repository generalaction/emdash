import { makePtySessionId } from '@shared/ptySessionId';
import { Terminal } from '@shared/terminal/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { log } from '@main/lib/logger';
import { ITerminalProvider } from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class LocalTerminalProvider implements ITerminalProvider {
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

    const pty = spawnLocalPty({
      id: sessionId,
      command: command?.command ?? '/bin/sh',
      args: command?.args ?? [],
      cwd: this.taskPath,
      env: {},
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    pty.onExit(() => {
      ptySessionRegistry.unregister(sessionId);
      if (this.sessions.has(sessionId)) {
        setTimeout(() => {
          this.spawnTerminal(terminal).catch((e) => {
            log.error('LocalTerminalProvider: respawn failed', {
              terminalId: terminal.id,
              error: String(e),
            });
          });
        }, 500);
        ptySessionRegistry.register(sessionId, pty);
      }
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
