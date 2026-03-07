import type { AgentSessionConfig } from './agent-session';
import type { GeneralSessionConfig } from './general-session';
import type { LifecycleSessionConfig } from './lifecycle-session';
import type { Pty } from '../core';
import type { LocalSpawnError } from '../local-pty';
import type { Ssh2OpenError } from '../ssh2-pty';
import type { Result } from '../../../lib/result';
import { ok, err } from '../../../lib/result';
import { spawnLocalPty } from '../local-pty';
import { openSsh2Pty } from '../ssh2-pty';
import { ptyManager } from '../pty-manager';
import { sshConnectionManager } from '../ssh-connection-manager';
import { buildSessionEnv } from '../env';
import { createClassifier } from '../agent-event-classifiers';
import { events } from '../../events';
import { agentEventChannel, agentSessionExitedChannel } from '@shared/events/agentEvents';
import { log } from '../../lib/logger';

export type SessionType = 'agent' | 'general' | 'lifecycle';

export type SessionConfig = AgentSessionConfig | GeneralSessionConfig | LifecycleSessionConfig;

/**
 * How the PTY connects to the target machine.
 *
 * local — spawns a process on the host.
 * ssh2  — opens a channel on an existing SSH connection managed by
 *         SshConnectionManager; identified by connectionId rather than a raw
 *         Client so the session manager can resolve it lazily.
 */
export type SessionTransport = { type: 'local' } | { type: 'ssh2'; connectionId: string };

export interface CreateSessionOptions {
  /**
   * Explicit session ID. When provided (e.g. conversationId or terminalId),
   * the PTY is registered under this ID so the renderer can subscribe to events
   * immediately after the RPC call returns without an extra round-trip.
   * Defaults to a random UUID when omitted.
   */
  id?: string;
  type: SessionType;
  config: SessionConfig;
  transport: SessionTransport;
}

export type CreateSessionError =
  | LocalSpawnError
  | Ssh2OpenError
  | { kind: 'no-ssh-client'; connectionId: string };

export interface PtySession {
  id: string;
  type: SessionType;
  config: SessionConfig;
  transport: SessionTransport;
  pty: Pty;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class PtySessionManager {
  private sessionMap: Map<string, PtySession> = new Map();

  async createSession(
    options: CreateSessionOptions
  ): Promise<Result<PtySession, CreateSessionError>> {
    const { type, config, transport } = options;
    const sessionId = options.id ?? crypto.randomUUID();

    const baseEnv = buildSessionEnv(type);
    const { command, args, cwd } = resolveSpawnParams(type, config, baseEnv);

    let pty: Pty;

    if (transport.type === 'local') {
      const env =
        type === 'lifecycle'
          ? { ...baseEnv, ...(config as LifecycleSessionConfig).extraEnv }
          : baseEnv;

      const result = spawnLocalPty({
        id: sessionId,
        command,
        args,
        cwd,
        env,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });

      if (!result.success) return result;
      pty = result.data;
    } else {
      const client = sshConnectionManager.getClient(transport.connectionId);
      if (!client) {
        return err({ kind: 'no-ssh-client', connectionId: transport.connectionId });
      }

      // SSH exec receives a single shell command string.
      const sshCommand = buildSshCommandString(command, args, cwd);
      const result = await openSsh2Pty(client, {
        id: sessionId,
        command: sshCommand,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });

      if (!result.success) return result;
      pty = result.data;
    }

    // Wire agent event classification before routing through PtyManager so the
    // classifier sees every raw chunk (it maintains its own sliding-window buffer).
    if (type === 'agent') {
      const cfg = config as AgentSessionConfig;
      const classifier = createClassifier(cfg.providerId);

      pty.onData((chunk) => {
        const result = classifier.classify(chunk);
        if (result) {
          events.emit(
            agentEventChannel,
            {
              event: {
                type: result.type,
                ptyId: sessionId,
                conversationId: cfg.conversationId,
                taskId: cfg.taskId,
                providerId: cfg.providerId,
                timestamp: Date.now(),
                payload: {
                  message: result.message,
                  notificationType:
                    result.type === 'notification' ? result.notificationType : undefined,
                },
              },
              appFocused: false,
            },
            sessionId
          );
        }
      });
    }

    const session: PtySession = { id: sessionId, type, config, transport, pty };
    this.sessionMap.set(sessionId, session);

    // Wire data / exit routing through the central PtyManager.
    ptyManager.addPty(sessionId, pty);

    // Handle per-session exit cleanup and callbacks.
    pty.onExit(({ exitCode }) => {
      this.sessionMap.delete(sessionId);

      if (type === 'lifecycle') {
        (config as LifecycleSessionConfig).onExit?.(exitCode);
      }

      if (type === 'agent') {
        const cfg = config as AgentSessionConfig;
        events.emit(
          agentSessionExitedChannel,
          { sessionId, conversationId: cfg.conversationId, taskId: cfg.taskId, exitCode },
          cfg.taskId
        );
      }
    });

    log.info('PtySessionManager: session created', { sessionId, type, cwd });
    return ok(session);
  }

  getSession(id: string): PtySession | undefined {
    return this.sessionMap.get(id);
  }

  /** All active sessions whose config carries the given taskId. */
  getSessionsForTask(taskId: string): PtySession[] {
    return Array.from(this.sessionMap.values()).filter((s) => {
      const cfg = s.config as { taskId?: string };
      return cfg.taskId === taskId;
    });
  }

  destroySession(id: string): void {
    const session = this.sessionMap.get(id);
    if (!session) return;
    try {
      session.pty.kill();
    } catch (e) {
      log.warn('PtySessionManager: error killing pty on destroySession', {
        sessionId: id,
        error: String(e),
      });
    }
    this.sessionMap.delete(id);
    ptyManager.removePty(id);
  }

  destroySessionsForTask(taskId: string): void {
    for (const session of this.getSessionsForTask(taskId)) {
      this.destroySession(session.id);
    }
  }
}

export const ptySessionManager = new PtySessionManager();

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SpawnParams {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Derive the executable, arguments, and working directory from a session
 * config. Applies shellSetup and tmux wrapping where relevant.
 */
function resolveSpawnParams(
  type: SessionType,
  config: SessionConfig,
  _env: Record<string, string>
): SpawnParams {
  const shell = process.env.SHELL ?? '/bin/sh';

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = [cfg.command, ...cfg.args].join(' ');
      const fullCmd = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;

      if (cfg.tmuxSessionName) {
        return buildTmuxParams(shell, cfg.tmuxSessionName, fullCmd, cfg.cwd);
      }

      return {
        command: shell,
        args: ['-c', fullCmd],
        cwd: cfg.cwd,
      };
    }

    case 'general': {
      const cfg = config as GeneralSessionConfig;
      if (cfg.shellSetup) {
        // Run shellSetup then hand off to an interactive login shell.
        return {
          command: shell,
          args: ['-c', `${cfg.shellSetup} && exec ${shell} -il`],
          cwd: cfg.cwd,
        };
      }
      return { command: shell, args: ['-il'], cwd: cfg.cwd };
    }

    case 'lifecycle': {
      const cfg = config as LifecycleSessionConfig;
      return {
        command: shell,
        args: ['-c', cfg.command],
        cwd: cfg.cwd,
      };
    }
  }
}

/**
 * Build spawn params that wrap a command in a tmux session for persistence.
 *
 * Behaviour:
 * - If a tmux session named `sessionName` already exists → attach to it.
 * - Otherwise → create a detached session running `cmd`, then attach.
 *
 * Uses JSON.stringify for quoting so embedded single-quotes and special
 * characters in the session name or command don't break the shell invocation.
 */
function buildTmuxParams(
  shell: string,
  sessionName: string,
  cmd: string,
  cwd: string
): SpawnParams {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(cmd);

  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux new-session -d -s ${quotedName} ${quotedCmd}`;
  const attach = `tmux attach-session -t ${quotedName}`;

  const tmuxCmd = `(${checkExists} && ${attach}) || (${newSession} && ${attach})`;

  return {
    command: shell,
    args: ['-c', tmuxCmd],
    cwd,
  };
}

/**
 * Build a single shell command string for use with `sshClient.exec()`.
 * Combines the binary + args and ensures the cwd is honoured remotely.
 */
function buildSshCommandString(command: string, args: string[], cwd: string): string {
  const invocation = [command, ...args].join(' ');
  return `cd ${JSON.stringify(cwd)} && ${invocation}`;
}
