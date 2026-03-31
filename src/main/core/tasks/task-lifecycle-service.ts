import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { spawnLocalPty } from '../pty/local-pty';
import type { Pty } from '../pty/pty';
import { buildTerminalEnv } from '../pty/pty-env';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { buildTmuxParams } from '../pty/spawn-utils';
import { killTmuxSession, makeTmuxSessionName } from '../pty/tmux-session-name';
import { wireTerminalDevServerWatcher } from '../terminals/dev-server-watcher';
import type { ExecFn } from '../utils/exec';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type ScriptDescriptor = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
};

export class TaskLifecycleService {
  private sessions = new Map<string, Pty>();
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly exec: ExecFn;
  private readonly taskEnvVars: Record<string, string>;

  constructor({
    projectId,
    taskId,
    taskPath,
    tmux = false,
    shellSetup,
    exec,
    taskEnvVars = {},
  }: {
    projectId: string;
    taskId: string;
    taskPath: string;
    tmux?: boolean;
    shellSetup?: string;
    exec: ExecFn;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.taskPath = taskPath;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.exec = exec;
    this.taskEnvVars = taskEnvVars;
  }

  async prepareLifecycleScript(
    script: ScriptDescriptor,
    options?: { initialSize?: { cols: number; rows: number } }
  ): Promise<void> {
    const { initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } = options ?? {};

    const id = await createScriptTerminalId({
      projectId: this.projectId,
      taskId: this.taskId,
      type: script.type,
      script: script.script,
    });

    if (this.sessions.has(id)) return;

    const userShell =
      process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    const sessionId = makePtySessionId(this.projectId, this.taskId, id);
    const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

    const idleCmd = `exec ${userShell}`;

    const params = tmuxSessionName
      ? buildTmuxParams(userShell, tmuxSessionName, idleCmd, this.taskPath)
      : { command: userShell, args: ['-c', idleCmd], cwd: this.taskPath };

    const pty = spawnLocalPty({
      id: sessionId,
      command: params.command,
      args: params.args,
      cwd: this.taskPath,
      env: { ...buildTerminalEnv(), ...this.taskEnvVars },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (script.type === 'run') {
      wireTerminalDevServerWatcher({ pty, taskId: this.taskId, terminalId: id, probe: false });
    }

    ptySessionRegistry.register(sessionId, pty, { preserveBufferOnExit: true });
    this.sessions.set(id, pty);

    pty.onExit(() => {
      this.sessions.delete(id);
      if (tmuxSessionName) {
        killTmuxSession(this.exec, tmuxSessionName);
      }
    });
  }
  async executeLifecycleScript(
    script: ScriptDescriptor,
    options?: { exit?: boolean }
  ): Promise<void> {
    const { exit = false } = options ?? {};

    const id = await createScriptTerminalId({
      projectId: this.projectId,
      taskId: this.taskId,
      type: script.type,
      script: script.script,
    });

    if (!this.sessions.has(id)) {
      await this.prepareLifecycleScript(script);
    }

    const pty = this.sessions.get(id);
    if (!pty) return;

    const scriptBody = this.shellSetup ? `${this.shellSetup} && ${script.script}` : script.script;
    const command = exit ? `${scriptBody}; exit` : scriptBody;

    pty.write(`${command}\n`);

    if (exit) {
      return new Promise<void>((resolve) => {
        pty.onExit(() => {
          resolve();
        });
      });
    }
  }

  async runLifecycleScript(
    script: ScriptDescriptor,
    options?: { initialSize?: { cols: number; rows: number } }
  ): Promise<void> {
    await this.prepareLifecycleScript(script, options);
    await this.executeLifecycleScript(script);
  }
}
