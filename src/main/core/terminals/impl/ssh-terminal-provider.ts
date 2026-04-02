import type { GeneralSessionConfig } from '@shared/general-session';
import { makePtySessionId } from '@shared/ptySessionId';
import { Terminal } from '@shared/terminals';
import { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import {
  type LifecycleScriptSpawnRequest,
  type TerminalProvider,
} from '@main/core/terminals/terminal-provider';
import { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
  trackForRehydrate: boolean;
};

export class SshTerminalProvider implements TerminalProvider {
  private sessions = new Map<string, Pty>();
  private respawnCounts = new Map<string, number>();
  private terminals = new Map<string, Terminal>();
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly exec: ExecFn;
  private readonly proxy: SshClientProxy;

  constructor({
    projectId,
    taskId,
    taskPath,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    exec,
    proxy,
  }: {
    projectId: string;
    taskId: string;
    taskPath: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    exec: ExecFn;
    proxy: SshClientProxy;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.taskPath = taskPath;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.exec = exec;
    this.proxy = proxy;
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
      trackForRehydrate: true,
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
        trackForRehydrate: false,
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
    if (policy.trackForRehydrate) {
      this.terminals.set(terminal.id, terminal);
    }

    const cfg: GeneralSessionConfig = {
      taskId: this.taskId,
      cwd: this.taskPath,
      shellSetup: this.shellSetup,
      tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
      command: command?.command,
      args: command?.args,
    };

    const sshCommand = resolveSshCommand('general', cfg, this.taskEnvVars);

    const result = await openSsh2Pty(this.proxy.client, {
      id: sessionId,
      command: sshCommand,
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (!result.success) {
      log.error('SshTerminalProvider: failed to open SSH channel', {
        sessionId,
        error: result.error.message,
      });
      return;
    }
    const pty = result.data;

    if (policy.watchDevServer) {
      wireTerminalDevServerWatcher({
        pty,
        taskId: this.taskId,
        terminalId: terminal.id,
        probe: false,
      });
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
          log.error('SshTerminalProvider: respawn limit reached, giving up', {
            terminalId: terminal.id,
            respawnCount: count,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        setTimeout(() => {
          this.spawnWithPolicy(terminal, initialSize, command, policy).catch((e) => {
            log.error('SshTerminalProvider: respawn failed', {
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

  /**
   * Re-spawn all terminals whose sessions are no longer active (e.g. after
   * an SSH reconnect). Skips user-deleted terminals and terminals that are
   * already running.
   */
  async rehydrate(): Promise<void> {
    const terminals = Array.from(this.terminals.values());
    await Promise.all(
      terminals.map(async (terminal) => {
        const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
        if (this.sessions.has(sessionId)) return;
        await this.spawnTerminal(terminal).catch((e) => {
          log.error('SshTerminalProvider: rehydrate failed', {
            terminalId: terminal.id,
            error: String(e),
          });
        });
      })
    );
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
    this.terminals.delete(terminalId);
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
    this.terminals.clear();
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
