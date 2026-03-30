import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { spawnLocalPty } from '../pty/local-pty';
import { Pty } from '../pty/pty';
import { buildTerminalEnv } from '../pty/pty-env';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { buildTmuxParams } from '../pty/spawn-utils';
import { killTmuxSession, makeTmuxSessionName } from '../pty/tmux-session-name';
import { wireTerminalDevServerWatcher } from '../terminals/dev-server-watcher';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { ExecFn } from '../utils/exec';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TaskLifecycleService {
  private sessions = new Map<string, Pty>();
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly terminals: TerminalProvider;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly exec: ExecFn;
  private readonly taskEnvVars: Record<string, string>;

  constructor({
    projectId,
    taskId,
    taskPath,
    terminals,
    tmux = false,
    shellSetup,
    exec,
    taskEnvVars = {},
  }: {
    projectId: string;
    taskId: string;
    taskPath: string;
    terminals: TerminalProvider;
    tmux?: boolean;
    shellSetup?: string;
    exec: ExecFn;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.taskPath = taskPath;
    this.terminals = terminals;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.exec = exec;
    this.taskEnvVars = taskEnvVars;
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
      this.terminals.spawnTerminal(
        { id, projectId: this.projectId, taskId: this.taskId, name: script.type },
        initialSize,
        { command: userShell, args: ['-c', script.script] }
      );
      return;
    }

    const sessionId = makePtySessionId(this.projectId, this.taskId, id);
    const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

    // Build the script command directly. Do NOT pass userShell as cfg.command into
    // resolveSpawnParams('general') — that path joins shell+args as a single string
    // then re-wraps in another shell -c, double-wrapping the command and breaking it.
    //
    // Always drop into an interactive shell after the script completes so the terminal
    // stays live. `exec` replaces the -c shell in-place; the new shell detects the PTY
    // and starts interactively (sources .zshrc/.bashrc, shows a prompt, etc.).
    const scriptBody = this.shellSetup ? `${this.shellSetup} && ${script.script}` : script.script;
    const scriptCmd = `${scriptBody}; exec ${userShell}`;

    const params = tmuxSessionName
      ? buildTmuxParams(userShell, tmuxSessionName, scriptCmd, this.taskPath)
      : { command: userShell, args: ['-c', scriptCmd], cwd: this.taskPath };

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

    return new Promise<void>((resolve) => {
      pty.onExit(() => {
        this.sessions.delete(id);
        // Do NOT call ptySessionRegistry.unregister here — the register() call above uses
        // preserveBufferOnExit: true, which keeps the ring buffer so late-connecting renderers
        // can replay output. Explicit unregister (ring buffer deletion) happens at teardown.
        if (tmuxSessionName) {
          killTmuxSession(this.exec, tmuxSessionName);
        }
        resolve();
      });
    });
  }
}
