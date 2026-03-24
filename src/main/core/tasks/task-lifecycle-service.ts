import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { spawnLocalPty } from '../pty/local-pty';
import { Pty } from '../pty/pty';
import { buildTerminalEnv } from '../pty/pty-env';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TaskLifecycleService {
  private sessions = new Map<string, Pty>();
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly terminals: TerminalProvider;

  constructor({
    projectId,
    taskId,
    taskPath,
    terminals,
  }: {
    projectId: string;
    taskId: string;
    taskPath: string;
    terminals: TerminalProvider;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.taskPath = taskPath;
    this.terminals = terminals;
  }

  async runLifecycleScript(
    script: {
      type: 'setup' | 'run' | 'teardown';
      script: string;
    },
    options: { shouldRespawn?: boolean; initialSize?: { cols: number; rows: number } } = {}
  ): Promise<void> {
    const { shouldRespawn = false, initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } =
      options;

    const id = await createScriptTerminalId({
      projectId: this.projectId,
      taskId: this.taskId,
      type: script.type,
      script: script.script,
    });

    if (this.sessions.has(id)) return;

    const userShell =
      process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    if (shouldRespawn) {
      console.log('respawning');
      this.terminals.spawnTerminal(
        { id, projectId: this.projectId, taskId: this.taskId, name: script.type },
        initialSize,
        {
          command: userShell,
          args: ['-c', script.script],
        }
      );
      return;
    }

    const sessionId = makePtySessionId(this.projectId, this.taskId, id);

    console.log('breaking');

    const pty = spawnLocalPty({
      id: sessionId,
      command: userShell,
      args: ['-c', script.script],
      cwd: this.taskPath,
      env: buildTerminalEnv(),
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(id, pty);

    return new Promise<void>((resolve) => {
      pty.onExit(() => {
        this.sessions.delete(id);
        ptySessionRegistry.unregister(sessionId);
        resolve();
      });
    });
  }
}
