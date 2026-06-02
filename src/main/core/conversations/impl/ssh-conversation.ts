import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { workspaceTrustService } from '@main/core/agent-hooks/workspace-trust-service';
import {
  type ConversationSpawnMode,
  ConversationSessionSupervisor,
} from '@main/core/conversations/conversation-session-supervisor';
import { resolveAgentSessionCommandArgs } from '@main/core/conversations/resolve-agent-session-command';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { buildAgentSessionCommand } from './agent-command';
import { createInitialPromptDelivery } from './initial-prompt-delivery';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { resolveProviderEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const RESPAWN_DELAY_MS = 500;

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private supervisor = new ConversationSessionSupervisor();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean = false;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;

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
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    },
    isResuming: boolean = false,
    initialPrompt?: string
  ): Promise<void> {
    return this.startSessionInternal(conversation, initialSize, isResuming, initialPrompt, false, {
      shellRefreshRetried: false,
    });
  }

  private async startSessionInternal(
    conversation: Conversation,
    initialSize: { cols: number; rows: number },
    isResuming: boolean,
    initialPrompt: string | undefined,
    requireDesired: boolean,
    options: { shellRefreshRetried: boolean }
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);

    const spawnSize = ptySessionRegistry.getLastSize(sessionId) ?? initialSize;
    const spawnMode: ConversationSpawnMode = isResuming ? 'resume' : 'fresh';
    const spawnToken = this.supervisor.beginStart(sessionId, {
      requireDesired,
      mode: spawnMode,
    });
    if (!spawnToken) return;

    try {
      await workspaceTrustService.maybeAutoTrustSsh({
        providerId: conversation.providerId,
        cwd: this.taskPath,
        ctx: this.ctx,
        remoteFs: new SshFileSystem(this.proxy, '/'),
        force: conversation.autoApprove === true,
      });

      const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
      const agentSession = resolveAgentSessionCommandArgs(conversation, isResuming, {
        requireProviderSessionId: false,
      });
      const initialPromptDelivery = createInitialPromptDelivery({
        providerId: conversation.providerId,
        conversationId: conversation.id,
        providerConfig,
        initialPrompt,
        isResuming: agentSession.isResuming,
      });
      const { command, args } = buildAgentSessionCommand({
        providerId: conversation.providerId,
        providerConfig,
        autoApprove: conversation.autoApprove,
        extraInitialArgs: initialPromptDelivery.argvAddition(),
        initialPrompt,
        sessionId: agentSession.sessionId,
        providerSessionId: conversation.providerSessionId,
        isResuming: agentSession.isResuming,
      });
      const providerEnv = resolveProviderEnv(providerConfig, {
        providerId: conversation.providerId,
        autoApprove: conversation.autoApprove,
      });

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
        resume: agentSession.isResuming,
      };

      const profile = await this.proxy.getRemoteShellProfile();
      const sshCommand = resolveSshCommand(
        'agent',
        cfg,
        { ...providerEnv, ...this.taskEnvVars },
        profile
      );

      const result = await openSsh2Pty(this.proxy, {
        id: sessionId,
        command: sshCommand,
        cols: spawnSize.cols,
        rows: spawnSize.rows,
      });

      if (!result.success) {
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

      pty.onExit((info) => {
        const { exitCode } = info;
        const decision = this.supervisor.handleExit(sessionId, pty);
        if (decision.kind === 'stale') return;
        const replacementSize = ptySessionRegistry.getLastSize(sessionId) ?? spawnSize;

        ptySessionRegistry.unregister(sessionId, { pty, exitInfo: info });
        this.sessions.delete(sessionId);
        if (decision.kind === 'stopped') return;

        if (this.tmux) {
          events.emit(agentSessionExitedChannel, {
            conversationId: conversation.id,
            taskId: conversation.taskId,
          });
          return;
        }

        if (!options.shellRefreshRetried && exitCode === 127) {
          this.scheduleShellRefreshRetry({
            conversation,
            sessionId,
            initialSize: replacementSize,
            isResuming,
            initialPrompt,
          });
          return;
        }

        if (options.shellRefreshRetried && exitCode === 127) {
          events.emit(agentSessionExitedChannel, {
            conversationId: conversation.id,
            taskId: conversation.taskId,
          });
          return;
        }

        events.emit(agentSessionExitedChannel, {
          conversationId: conversation.id,
          taskId: conversation.taskId,
        });

        if (this.supervisor.isDesired(sessionId)) {
          this.scheduleReplacement({
            conversation,
            initialSize: replacementSize,
            mode: decision.mode,
          });
        }
      });

      if (!this.supervisor.acceptSpawn(sessionId, spawnToken, pty)) {
        try {
          pty.kill();
        } catch {}
        if (ptySessionRegistry.get(sessionId) === pty) {
          ptySessionRegistry.unregister(sessionId);
        }
        return;
      }

      ptySessionRegistry.register(sessionId, pty, {
        metadata: {
          providerId: conversation.providerId,
          title: conversation.title,
          isRemote: true,
        },
      });
      this.sessions.set(sessionId, pty);
      scheduleInitialPromptInjection({
        pty,
        conversation,
        initialPrompt,
        isResuming: agentSession.isResuming,
      });
      telemetryService.capture('agent_run_started', {
        provider: conversation.providerId,
        project_id: conversation.projectId,
        task_id: conversation.taskId,
        conversation_id: conversation.id,
      });
    } catch (error) {
      this.supervisor.failSpawn(sessionId, spawnToken);
      throw error;
    }
  }

  private detachPty(sessionId: string): void {
    const pty = this.supervisor.stop(sessionId) ?? this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    ptySessionRegistry.unregister(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshAgentProvider: error killing PTY', {
          sessionId,
          error: String(e),
        });
      }
    }
  }

  async detachSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.detachPty(sessionId);
    if (!this.tmux) {
      this.knownSessionIds.delete(sessionId);
      this.supervisor.forget(sessionId);
    }
  }

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    const pty = this.supervisor.stop(sessionId) ?? this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    ptySessionRegistry.unregister(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshAgentProvider: error killing PTY', {
          sessionId,
          error: String(e),
        });
      }
    }
    if (this.tmux) {
      await killTmuxSession(this.ctx, makeTmuxSessionName(sessionId));
    }
    this.supervisor.forget(sessionId);
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(sessionIds.map((id) => killTmuxSession(this.ctx, makeTmuxSessionName(id))));
    }
    for (const sessionId of sessionIds) {
      this.supervisor.forget(sessionId);
    }
    this.knownSessionIds.clear();
  }

  async detachAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      this.supervisor.stop(sessionId);
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }

  private scheduleShellRefreshRetry({
    conversation,
    sessionId,
    initialSize,
    isResuming,
    initialPrompt,
  }: {
    conversation: Conversation;
    sessionId: string;
    initialSize: { cols: number; rows: number };
    isResuming: boolean;
    initialPrompt: string | undefined;
  }): void {
    setTimeout(() => {
      if (!this.supervisor.isDesired(sessionId)) return;
      this.proxy
        .refreshRemoteShellProfile()
        .then(() => {
          if (!this.supervisor.isDesired(sessionId)) return;
          return this.startSessionInternal(
            conversation,
            initialSize,
            isResuming,
            initialPrompt,
            true,
            { shellRefreshRetried: true }
          );
        })
        .catch((e) => {
          log.error('SshConversationProvider: shell refresh retry failed', {
            conversationId: conversation.id,
            error: String(e),
          });
        });
    }, RESPAWN_DELAY_MS);
  }

  private scheduleReplacement({
    conversation,
    initialSize,
    mode,
  }: {
    conversation: Conversation;
    initialSize: { cols: number; rows: number };
    mode: ConversationSpawnMode;
  }): void {
    setTimeout(() => {
      this.startSessionInternal(conversation, initialSize, mode === 'resume', undefined, true, {
        shellRefreshRetried: false,
      }).catch((e) => {
        log.error('SshConversationProvider: replacement failed', {
          conversationId: conversation.id,
          error: String(e),
        });
      });
    }, RESPAWN_DELAY_MS);
  }
}
