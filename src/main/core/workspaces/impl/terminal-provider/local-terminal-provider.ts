import { makePtySessionId } from '@shared/ptySessionId';
import { log } from '@main/lib/logger';
import { ok, Result } from '@main/lib/result';
import { spawnLocalPty } from '@main/pty/local-pty';
import { Pty } from '@main/pty/pty';
import { buildSessionEnv } from '@main/pty/pty-env';
import { ptySessionRegistry } from '@main/pty/pty-session-registry';
import { resolveSpawnParams } from '@main/pty/spawn-utils';
import { GeneralSessionConfig } from '@main/workspaces/impl/terminal-provider/general-session';
import {
  CreateSessionError,
  ITerminalProvider,
  TerminalSpawnOptions,
} from '../../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class LocalTerminalProvider implements ITerminalProvider {
  private sessions = new Map<string, Pty>();
  /** Terminals explicitly killed by the user — suppresses auto-respawn. */
  private deletedTerminals = new Set<string>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {}

  async spawnTerminal(opts: TerminalSpawnOptions): Promise<Result<void, CreateSessionError>> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.terminalId);

    const cfg: GeneralSessionConfig = {
      taskId: opts.taskId,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
      shellSetup: opts.shellSetup,
    };

    const env = buildSessionEnv('general');
    const { command, args, cwd } = resolveSpawnParams('general', cfg);

    const result = spawnLocalPty({
      id: sessionId,
      command,
      args,
      cwd,
      env,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
    if (!result.success) {
      log.error('LocalTerminalProvider: failed to spawn PTY', {
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
            log.error('LocalTerminalProvider: respawn failed', {
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
    // Prevent unbounded growth of the tombstone set
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
