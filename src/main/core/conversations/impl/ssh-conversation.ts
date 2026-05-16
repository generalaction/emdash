import type { AgentSessionConfig } from '@shared/agent-session';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { buildAgentCommand } from './agent-command';
import {
  getCurrentRemoteDroidSessionIds,
  rememberRemoteDroidSessionId,
} from './droid-session-resolver';
import { resolveProviderEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function remoteNowMs(ctx: IExecutionContext): Promise<number> {
  try {
    const { stdout } = await ctx.exec('date', ['+%s']);
    const seconds = Number(stdout.trim());
    if (Number.isFinite(seconds)) return seconds * 1000;
  } catch {}
  return Date.now();
}

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, number>();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean = false;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;
  private readonly remoteFs: SshFileSystem;
  private droidFreshStartQueue: Promise<void> = Promise.resolve();

  constructor({
    projectId,
    taskPath,
    taskId,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    ctx,
    proxy,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.proxy = proxy;
    this.remoteFs = new SshFileSystem(proxy, '/');
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    isResuming: boolean = false,
    initialPrompt?: string
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);

    if (this.sessions.has(sessionId)) return;

    let releaseDroidFreshStart: (() => void) | undefined;
    let releasedDroidFreshStart = false;
    const releaseQueuedDroidFreshStart = () => {
      if (!releaseDroidFreshStart || releasedDroidFreshStart) return;
      releasedDroidFreshStart = true;
      releaseDroidFreshStart();
    };
    if (conversation.providerId === 'droid' && !isResuming) {
      const previousDroidFreshStart = this.droidFreshStartQueue;
      this.droidFreshStartQueue = previousDroidFreshStart.then(
        () =>
          new Promise<void>((resolve) => {
            releaseDroidFreshStart = resolve;
          })
      );
      await previousDroidFreshStart;
    }

    try {
      await claudeTrustService.maybeAutoTrustSsh({
        providerId: conversation.providerId,
        cwd: this.taskPath,
        ctx: this.ctx,
        remoteFs: this.remoteFs,
      });
    } catch (error) {
      releaseQueuedDroidFreshStart();
      throw error;
    }

    let startedAt = 0;
    let existingDroidSessionIds: string[] = [];
    try {
      const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
      if (conversation.providerId === 'droid' && !isResuming) {
        existingDroidSessionIds = await getCurrentRemoteDroidSessionIds({
          cwd: this.taskPath,
          ctx: this.ctx,
          fs: this.remoteFs,
        });
      }
      if (conversation.providerId === 'droid' && isResuming && !conversation.providerSessionId) {
        releaseQueuedDroidFreshStart();
        throw new Error('Cannot resume Droid session without a stored provider session id.');
      }
      const { command, args } = buildAgentCommand({
        providerId: conversation.providerId,
        providerConfig,
        autoApprove: conversation.autoApprove,
        sessionId: conversation.providerSessionId ?? conversation.id,
        isResuming,
        initialPrompt,
      });
      const providerEnv = resolveProviderEnv(providerConfig);

      const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

      const cfg: AgentSessionConfig = {
        taskId: this.taskId,
        conversationId: conversation.id,
        providerId: conversation.providerId,
        command,
        args,
        cwd: this.taskPath,
        shellSetup: this.shellSetup,
        tmuxSessionName,
        autoApprove: conversation.autoApprove ?? false,
        resume: isResuming,
      };

      const profile = await this.proxy.getRemoteShellProfile();
      const sshCommand = resolveSshCommand(
        'agent',
        cfg,
        { ...providerEnv, ...this.taskEnvVars },
        profile
      );

      startedAt = await remoteNowMs(this.ctx);
      let result: Awaited<ReturnType<typeof openSsh2Pty>>;
      try {
        result = await openSsh2Pty(this.proxy, {
          id: sessionId,
          command: sshCommand,
          cols: initialSize.cols,
          rows: initialSize.rows,
        });
      } catch (error) {
        releaseQueuedDroidFreshStart();
        throw error;
      }

      if (!result.success) {
        releaseQueuedDroidFreshStart();
        log.error('SshConversationProvider: failed to open SSH channel', {
          sessionId,
          error: result.error.message,
        });
        throw new Error(result.error.message);
      }

      const pty = result.data;

      // hooks not supported yet, rely on classifier for visual indicator
      wireAgentClassifier({
        pty,
        providerId: conversation.providerId,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });

      pty.onExit(({ exitCode }) => {
        ptySessionRegistry.unregister(sessionId);
        const shouldRespawn = this.sessions.has(sessionId);
        this.sessions.delete(sessionId);
        telemetryService.capture('agent_run_finished', {
          provider: conversation.providerId,
          exit_code: typeof exitCode === 'number' ? exitCode : -1,
          project_id: conversation.projectId,
          task_id: conversation.taskId,
          conversation_id: conversation.id,
        });
        events.emit(agentSessionExitedChannel, {
          sessionId,
          projectId: conversation.projectId,
          conversationId: conversation.id,
          taskId: conversation.taskId,
          exitCode,
        });
        if (shouldRespawn && !this.tmux) {
          const count = (this.respawnCounts.get(sessionId) ?? 0) + 1;
          this.respawnCounts.set(sessionId, count);

          if (count > MAX_RESPAWNS && !isResuming) {
            log.error('SshConversationProvider: respawn limit reached, giving up', {
              conversationId: conversation.id,
            });
            this.respawnCounts.delete(sessionId);
            return;
          }

          const resumeNext = isResuming && count <= MAX_RESPAWNS;
          if (count > MAX_RESPAWNS) this.respawnCounts.set(sessionId, 0);

          setTimeout(() => {
            this.startSession(conversation, initialSize, resumeNext, initialPrompt).catch((e) => {
              log.error('SshConversationProvider: respawn failed', {
                conversationId: conversation.id,
                error: String(e),
              });
            });
          }, 500);
        }
      });

      ptySessionRegistry.register(sessionId, pty, {
        metadata: { providerId: conversation.providerId, title: conversation.title },
      });
      this.sessions.set(sessionId, pty);
    } catch (error) {
      releaseQueuedDroidFreshStart();
      throw error;
    }

    if (conversation.providerId === 'droid' && !isResuming) {
      void (async () => {
        try {
          for (const delay of [1000, 2000, 4000]) {
            await sleep(delay);
            const stored = await rememberRemoteDroidSessionId({
              conversationId: conversation.id,
              cwd: this.taskPath,
              startedAt,
              initialPrompt,
              existingSessionIds: existingDroidSessionIds,
              ctx: this.ctx,
              fs: this.remoteFs,
            });
            if (stored) return;
          }
        } catch (error) {
          log.warn('SshConversationProvider: failed to remember Droid session id', {
            conversationId: conversation.id,
            error: String(error),
          });
        } finally {
          releaseQueuedDroidFreshStart();
        }
      })();
    }

    telemetryService.capture('agent_run_started', {
      provider: conversation.providerId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
  }

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshAgentProvider: error killing PTY', { sessionId, error: String(e) });
      }
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
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
