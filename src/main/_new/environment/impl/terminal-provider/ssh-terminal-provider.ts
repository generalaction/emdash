import { Pty } from '@/_new/pty/pty';
import {
  CreateSessionError,
  ITerminalProvider,
  TerminalSpawnOptions,
} from '../../terminal-provider';
import { Client } from 'ssh2';
import { ok, Result } from '@/_deprecated/lib/result';
import { makePtySessionId } from '@shared/ptySessionId';
import { GeneralSessionConfig } from '@/_new/environment/impl/terminal-provider/general-session';
import { buildSshCommandString, resolveSpawnParams } from '@/_new/pty/spawn-utils';
import { openSsh2Pty } from '@/_new/pty/ssh2-pty';
import { log } from '@/_new/lib/logger';
import { ptySessionRegistry } from '@/_new/pty/pty-session-registry';

export class SshTerminalProvider implements ITerminalProvider {
  private sessions = new Map<string, Pty>();
  /** Terminals explicitly killed by the user — suppresses auto-respawn. */
  private deletedTerminals = new Set<string>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly client: Client
  ) {}

  async spawnTerminal(opts: TerminalSpawnOptions): Promise<Result<void, CreateSessionError>> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.terminalId);

    const cfg: GeneralSessionConfig = {
      taskId: opts.taskId,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
      shellSetup: opts.shellSetup,
    };

    const { command, args, cwd } = resolveSpawnParams('general', cfg);
    const sshCommand = buildSshCommandString(command, args, cwd);

    const result = await openSsh2Pty(this.client, {
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
