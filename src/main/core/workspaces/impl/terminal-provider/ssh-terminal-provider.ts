import { makePtySessionId } from '@shared/ptySessionId';
import { log } from '@main/lib/logger';
import { ok, Result } from '@main/lib/result';
import { Pty } from '@main/pty/pty';
import { ptySessionRegistry } from '@main/pty/pty-session-registry';
import { buildSshCommandString, resolveSpawnParams } from '@main/pty/spawn-utils';
import { openSsh2Pty } from '@main/pty/ssh2-pty';
import { GeneralSessionConfig } from '@main/workspaces/impl/terminal-provider/general-session';
import type { SshClientProxy } from '../../../ssh/ssh-client-proxy';
import {
  CreateSessionError,
  ITerminalProvider,
  TerminalSpawnOptions,
} from '../../terminal-provider';

export class SshTerminalProvider implements ITerminalProvider {
  private sessions = new Map<string, Pty>();
  /** Terminals explicitly killed by the user — suppresses auto-respawn. */
  private deletedTerminals = new Set<string>();
  /** Stored spawn options per terminal ID — used for rehydration on reconnect. */
  private terminalOpts = new Map<string, TerminalSpawnOptions>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly proxy: SshClientProxy
  ) {}

  async spawnTerminal(opts: TerminalSpawnOptions): Promise<Result<void, CreateSessionError>> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.terminalId);

    // Store opts for rehydration on reconnect.
    this.terminalOpts.set(opts.terminalId, opts);

    const cfg: GeneralSessionConfig = {
      taskId: opts.taskId,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
      shellSetup: opts.shellSetup,
    };

    const { command, args, cwd } = resolveSpawnParams('general', cfg);
    const sshCommand = buildSshCommandString(command, args, cwd);

    const result = await openSsh2Pty(this.proxy.client, {
      id: sessionId,
      command: sshCommand,
      cols: 80,
      rows: 24,
    });

    if (!result.success) {
      log.error('SshTerminalProvider: failed to spawn terminal PTY', {
        terminalId: opts.terminalId,
        error: result.error,
      });
      return result;
    }

    const pty = result.data;

    pty.onExit(() => {
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
      if (!this.deletedTerminals.has(opts.terminalId)) {
        // Skip auto-respawn if the connection is currently down — the
        // EnvironmentProviderManager will trigger rehydrate() on reconnect.
        if (!this.proxy.isConnected) return;
        setTimeout(() => {
          this.spawnTerminal(opts).catch((e) => {
            log.error('SshTerminalProvider: respawn failed', {
              terminalId: opts.terminalId,
              error: String(e),
            });
          });
        }, 500);
      }
    });

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);
    return ok();
  }

  /**
   * Re-spawn all terminals whose sessions are no longer active (e.g. after
   * an SSH reconnect). Skips user-deleted terminals and terminals that are
   * already running.
   */
  async rehydrate(): Promise<void> {
    for (const [terminalId, opts] of this.terminalOpts) {
      if (this.deletedTerminals.has(terminalId)) continue;
      const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.terminalId);
      if (this.sessions.has(sessionId)) continue;
      await this.spawnTerminal(opts).catch((e) => {
        log.error('SshTerminalProvider: rehydrate failed', {
          terminalId,
          error: String(e),
        });
      });
    }
  }

  killTerminal(terminalId: string): void {
    this.deletedTerminals.add(terminalId);
    const sessionId = makePtySessionId(this.projectId, this.taskId, terminalId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    setTimeout(() => this.deletedTerminals.delete(terminalId), 10_000);
  }

  destroyAll(): void {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
