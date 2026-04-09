import type { GeneralSessionConfig } from '@shared/general-session';
import { makePtySessionId } from '@shared/ptySessionId';
import { Terminal } from '@shared/terminals';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSpawnParams } from '@main/core/pty/spawn-utils';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';
import { type LifecycleScriptSpawnRequest, type TerminalProvider } from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
};

export class LocalTerminalProvider implements TerminalProvider {
  private sessions = new Map<string, Pty>();
  private respawnCounts = new Map<string, number>();
  private readonly projectId: string;
  private readonly scopeId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly exec: ExecFn;
  private readonly taskEnvVars: Record<string, string>;

  constructor({
    projectId,
    scopeId,
    taskPath,
    tmux = false,
    shellSetup,
    exec,
    taskEnvVars = {},
  }: {
    projectId: string;
    scopeId: string;
    taskPath: string;
    tmux?: boolean;
    shellSetup?: string;
    exec: ExecFn;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.scopeId = scopeId;
    this.taskPath = taskPath;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.exec = exec;
    this.taskEnvVars = taskEnvVars;
  }

  async spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    command?: { command: string; args: string[] }
  ): Promise<void> {
    return this.spawnWithPolicy(terminal, initialSize, command, {
      respawnOnExit: true,
      preserveBufferOnExit: false,
      watchDevServer: true,
    });
  }

  async spawnLifecycleScript({
    terminal,
    command,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    respawnOnExit = false,
    preserveBufferOnExit = true,
    watchDevServer = false,
  }: LifecycleScriptSpawnRequest): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      { command, args: [] },
      {
        respawnOnExit,
        preserveBufferOnExit,
        watchDevServer,
      }
    );
  }

  private async spawnWithPolicy(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: { command: string; args: string[] } | undefined,
    policy: SpawnPolicy
  ): Promise<void> {
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    if (this.sessions.has(sessionId)) return;

    const cfg: GeneralSessionConfig = {
      taskId: this.scopeId,
      cwd: this.taskPath,
      shellSetup: this.shellSetup,
      tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
      command: command?.command,
      args: command?.args,
    };
    const params = resolveSpawnParams('general', cfg);

    const pty = spawnLocalPty({
      id: sessionId,
      command: params.command,
      args: params.args,
      cwd: this.taskPath,
      env: { ...buildTerminalEnv(), ...this.taskEnvVars },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (policy.watchDevServer) {
      wireTerminalDevServerWatcher({ pty, scopeId: this.scopeId, terminalId: terminal.id });
    }

    pty.onExit(() => {
      const shouldRespawn = policy.respawnOnExit && this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      if (!policy.preserveBufferOnExit) {
        ptySessionRegistry.unregister(sessionId);
      }
      if (shouldRespawn && !this.tmux) {
        const count = (this.respawnCounts.get(sessionId) ?? 0) + 1;
        this.respawnCounts.set(sessionId, count);

        if (count > MAX_RESPAWNS) {
          log.error('LocalTerminalProvider: respawn limit reached, giving up', {
            terminalId: terminal.id,
            respawnCount: count,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        setTimeout(() => {
          this.spawnWithPolicy(terminal, initialSize, command, policy).catch((e) => {
            log.error('LocalTerminalProvider: respawn failed', {
              terminalId: terminal.id,
              error: String(e),
            });
          });
        }, 500);
      }
    });

    ptySessionRegistry.register(sessionId, pty, {
      preserveBufferOnExit: policy.preserveBufferOnExit,
    });
    this.sessions.set(sessionId, pty);
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    if (this.tmux) {
      await killTmuxSession(this.exec, makeTmuxSessionName(sessionId));
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(
        sessionIds.map((id) => killTmuxSession(this.exec, makeTmuxSessionName(id)))
      );
    }
  }

  async detachAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
