import type { IExecutionContext } from '@main/core/execution-context/types';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { wireTerminalUrlDetector } from '@main/core/preview-servers/terminal-url-detector';
import { isUnexpectedPtyExit } from '@main/core/pty/exit-classification';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry, type PtySessionMetadata } from '@main/core/pty/pty-session-registry';
import {
  logLocalPtySpawnWarnings,
  resolveLocalPtySpawn,
  type PtyCommandSpec,
  type PtySpawnIntent,
} from '@main/core/pty/pty-spawn-platform';
import { getTerminalColorEnv } from '@main/core/pty/terminal-color-scheme';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { resolveTerminalShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { log } from '@main/lib/logger';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { TerminalShellId } from '@shared/core/terminals/terminal-settings';
import type { Terminal } from '@shared/core/terminals/terminals';
import {
  type LifecycleScriptSpawnRequest,
  type TerminalProvider,
  type TerminalSpawnOptions,
} from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
};

export class LocalTerminalProvider implements TerminalProvider {
  readonly kind = 'local' as const;

  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private shellProfiles = new Map<string, ResolvedShellProfile>();
  private respawnCounts = new Map<string, number>();
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly scopeId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;

  constructor({
    projectId,
    workspaceId,
    scopeId,
    taskPath,
    tmux = false,
    shellSetup,
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    workspaceId?: string;
    scopeId: string;
    taskPath: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.workspaceId = workspaceId ?? scopeId;
    this.scopeId = scopeId;
    this.taskPath = taskPath;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
  }

  async spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: TerminalSpawnOptions = {}
  ): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      options.command
        ? { kind: 'argv', command: options.command.command, args: options.command.args }
        : undefined,
      undefined,
      options.shell ?? terminal.shellId,
      { title: terminal.name },
      {
        respawnOnExit: true,
        preserveBufferOnExit: false,
        watchDevServer: true,
      }
    );
  }

  async spawnLifecycleScript({
    terminal,
    command,
    shellSetup,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    respawnOnExit = false,
    preserveBufferOnExit = true,
    watchDevServer = false,
  }: LifecycleScriptSpawnRequest): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      command === undefined ? undefined : { kind: 'shell-line', commandLine: command },
      shellSetup,
      'system',
      undefined,
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
    command: PtyCommandSpec | undefined,
    shellSetup: string | undefined,
    shellIntent: TerminalShellId,
    metadata: PtySessionMetadata | undefined,
    policy: SpawnPolicy
  ): Promise<void> {
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    this.knownSessionIds.add(sessionId);
    if (this.sessions.has(sessionId)) return;
    const shellProfile = await this.getSessionShellProfile(sessionId, shellIntent);

    const intent: PtySpawnIntent = command
      ? {
          kind: 'run-command',
          cwd: this.taskPath,
          command,
          shellProfile,
          shellSetup: shellSetup ?? this.shellSetup,
          tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
        }
      : {
          kind: 'interactive-shell',
          cwd: this.taskPath,
          shellProfile,
          shellSetup: shellSetup ?? this.shellSetup,
          tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
        };
    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent,
    });

    logLocalPtySpawnWarnings('LocalTerminalProvider', resolved.warnings, {
      terminalId: terminal.id,
      sessionId,
    });

    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildTerminalEnv({ shellProfile }),
        ...(await getTerminalColorEnv()),
        ...this.taskEnvVars,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (policy.watchDevServer) {
      wireTerminalUrlDetector({
        pty,
        probeLocalPorts: true,
        onDetected: (server) => {
          void previewServerService.registerDetectedTarget({
            projectId: this.projectId,
            workspaceId: this.workspaceId,
            transport: 'local',
            source: { kind: 'terminal-output', terminalId: terminal.id },
            protocol: server.protocol,
            host: server.host,
            port: server.port,
            urlPath: server.urlPath,
          });
        },
        onSourceClosed: (event) =>
          previewServerService.handleTerminalSourceClosed({
            projectId: this.projectId,
            workspaceId: this.workspaceId,
            terminalId: terminal.id,
            transport: 'local',
            reason: event.reason,
            server: 'server' in event ? event.server : undefined,
          }),
      });
    }

    pty.onExit((info) => {
      const { exitCode, signal } = info;
      const shouldRespawn =
        policy.respawnOnExit &&
        this.sessions.has(sessionId) &&
        isUnexpectedPtyExit({ exitCode, signal });
      this.sessions.delete(sessionId);
      if (!policy.preserveBufferOnExit) {
        ptySessionRegistry.unregister(sessionId, { pty, exitInfo: info });
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
          this.shellProfiles.delete(sessionId);
          return;
        }

        setTimeout(() => {
          this.spawnWithPolicy(
            terminal,
            initialSize,
            command,
            shellSetup,
            shellIntent,
            metadata,
            policy
          ).catch((e) => {
            log.error('LocalTerminalProvider: respawn failed', {
              terminalId: terminal.id,
              error: String(e),
            });
          });
        }, 500);
      } else {
        this.shellProfiles.delete(sessionId);
      }
    });

    ptySessionRegistry.register(sessionId, pty, {
      preserveBufferOnExit: policy.preserveBufferOnExit,
      metadata,
    });
    this.sessions.set(sessionId, pty);
  }

  private async getSessionShellProfile(
    sessionId: string,
    shellIntent: TerminalShellId
  ): Promise<ResolvedShellProfile> {
    const existing = this.shellProfiles.get(sessionId);
    if (existing) return existing;
    const profile = await resolveTerminalShellWithSystemFallback({
      intent: shellIntent,
      target: { kind: 'local' },
      onFallback: () => {
        log.warn('LocalTerminalProvider: stored shell unavailable, using system shell', {
          shell: shellIntent,
          sessionId,
        });
      },
    });
    this.shellProfiles.set(sessionId, profile);
    return profile;
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    this.knownSessionIds.delete(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    this.shellProfiles.delete(sessionId);
    if (this.tmux) {
      await killTmuxSession(this.ctx, makeTmuxSessionName(sessionId));
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(sessionIds.map((id) => killTmuxSession(this.ctx, makeTmuxSessionName(id))));
    }
    this.knownSessionIds.clear();
    this.shellProfiles.clear();
  }

  async detachAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
      this.shellProfiles.delete(sessionId);
    }
    this.sessions.clear();
  }
}
