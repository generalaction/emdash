import { workspaceTrustService } from '@main/core/agent-hooks/workspace-trust-service';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { ConversationSessionSupervisor } from '@main/core/conversations/conversation-session-supervisor';
import { resolveAgentSessionCommandArgs } from '@main/core/conversations/resolve-agent-session-command';
import type { ConversationProvider } from '@main/core/conversations/types';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { MultiplexerBackend } from '@main/core/pty/multiplexer';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { getTerminalColorEnv } from '@main/core/pty/terminal-color-scheme';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { AgentSessionConfig } from '@shared/core/agents/agent-session';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { resolveAgentExecutable } from './resolve-agent-executable';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const RESPAWN_DELAY_MS = 500;

function parseExtraArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.trim().split(/\s+/);
}

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private supervisor = new ConversationSessionSupervisor();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly multiplexer: MultiplexerBackend | null;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;

  constructor({
    projectId,
    taskPath,
    taskId,
    taskEnvVars = {},
    multiplexer = null,
    shellSetup,
    ctx,
    proxy,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    taskEnvVars?: Record<string, string>;
    multiplexer?: MultiplexerBackend | null;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskEnvVars = taskEnvVars;
    this.multiplexer = multiplexer;
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
    const spawnToken = this.supervisor.beginStart(sessionId, {
      requireDesired,
      mode: isResuming ? 'resume' : 'fresh',
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
      const plugin = getPlugin(conversation.providerId);

      const binaryName =
        plugin.capabilities.hostDependency.binaryNames[0] ?? conversation.providerId;
      const executableCli = await resolveAgentExecutable({
        providerId: conversation.providerId,
        binaryName,
        ctx: this.ctx,
        hostDependencyStore,
        connectionId: this.proxy.connectionId,
      });

      const agentCommand = plugin.behavior.prompt!.buildCommand({
        cli: executableCli,
        extraArgs: parseExtraArgs(providerConfig?.extraArgs),
        autoApprove: conversation.autoApprove ?? false,
        initialPrompt: agentSession.isResuming ? undefined : initialPrompt,
        sessionId: agentSession.sessionId,
        providerSessionId: conversation.providerSessionId ?? undefined,
        isResuming: agentSession.isResuming,
        model: '',
      });

      const customEnv = providerConfig?.env ?? {};
      const providerEnv: Record<string, string> = { ...agentCommand.env, ...customEnv };

      const cfg: AgentSessionConfig = {
        taskId: this.taskId,
        conversationId: conversation.id,
        providerId: conversation.providerId,
        command: agentCommand.command,
        args: agentCommand.args,
        cwd: this.taskPath,
        shellSetup: this.shellSetup,
        multiplexer: this.multiplexer
          ? { id: this.multiplexer.id, sessionName: this.multiplexer.makeSessionName(sessionId) }
          : undefined,
        autoApprove: conversation.autoApprove ?? false,
        resume: agentSession.isResuming,
      };

      const [profile, colorEnv] = await Promise.all([
        this.proxy.getRemoteShellProfile(),
        getTerminalColorEnv(),
      ]);
      const sshCommand = resolveSshCommand(
        'agent',
        cfg,
        { ...providerEnv, ...colorEnv, ...this.taskEnvVars },
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

      pty.onExit((info) => {
        const { exitCode } = info;
        const decision = this.supervisor.handleExit(sessionId, pty);
        if (decision.kind === 'stale') return;
        const replacementSize = ptySessionRegistry.getLastSize(sessionId) ?? spawnSize;

        ptySessionRegistry.unregister(sessionId, { pty, exitInfo: info });
        this.sessions.delete(sessionId);
        if (decision.kind === 'stopped') return;

        if (decision.kind === 'failed') {
          events.emit(agentSessionExitedChannel, {
            conversationId: conversation.id,
            taskId: conversation.taskId,
          });
          return;
        }

        if (this.multiplexer) {
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
            isResuming: decision.kind === 'respawnResume',
            initialPrompt,
          });
          return;
        }

        if (options.shellRefreshRetried && exitCode === 127) {
          this.supervisor.stop(sessionId);
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
            isResuming: decision.kind === 'respawnResume',
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
    if (!this.multiplexer) {
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
    await this.multiplexer?.killSession(this.ctx, this.multiplexer.makeSessionName(sessionId));
    this.supervisor.forget(sessionId);
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    await this.detachAll();
    if (this.multiplexer) {
      const mux = this.multiplexer;
      await Promise.all(sessionIds.map((id) => mux.killSession(this.ctx, mux.makeSessionName(id))));
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
    isResuming,
  }: {
    conversation: Conversation;
    initialSize: { cols: number; rows: number };
    isResuming: boolean;
  }): void {
    setTimeout(() => {
      this.startSessionInternal(conversation, initialSize, isResuming, undefined, true, {
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
