import { homedir } from 'node:os';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { ensureHooksInstalled } from '@main/core/agent-hooks/hook-config-service';
import { workspaceTrustService } from '@main/core/agent-hooks/workspace-trust-service';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { ConversationSessionSupervisor } from '@main/core/conversations/conversation-session-supervisor';
import { resolveAgentSessionCommandArgs } from '@main/core/conversations/resolve-agent-session-command';
import type { ConversationProvider } from '@main/core/conversations/types';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { getTerminalColorEnv } from '@main/core/pty/terminal-color-scheme';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { makePtyId } from '@shared/core/pty/ptyId';
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

export class LocalConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private supervisor = new ConversationSessionSupervisor();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly shellProfile: ResolvedShellProfile;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;
  constructor({
    projectId,
    taskPath,
    taskId,
    tmux = false,
    shellSetup,
    shellProfile,
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    tmux?: boolean;
    shellSetup?: string;
    shellProfile: ResolvedShellProfile;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.shellProfile = shellProfile;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
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
    return this.startSessionInternal(conversation, initialSize, isResuming, initialPrompt, false);
  }

  private async startSessionInternal(
    conversation: Conversation,
    initialSize: { cols: number; rows: number },
    isResuming: boolean,
    initialPrompt: string | undefined,
    requireDesired: boolean
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
      await workspaceTrustService.maybeAutoTrustLocal({
        providerId: conversation.providerId,
        cwd: this.taskPath,
        homedir: homedir(),
        force: conversation.autoApprove === true,
      });
      await ensureHooksInstalled({
        providerId: conversation.providerId,
        taskPath: this.taskPath,
      });

      const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
      const agentSession = resolveAgentSessionCommandArgs(conversation, isResuming);
      const plugin = getPlugin(conversation.providerId);

      const binaryName =
        plugin.capabilities.hostDependency.binaryNames[0] ?? conversation.providerId;
      const cachedStatePath = localDependencyManager.get(conversation.providerId as never)?.path;
      const executableCli = await resolveAgentExecutable({
        providerId: conversation.providerId,
        binaryName,
        ctx: this.ctx,
        hostDependencyStore,
        cachedStatePath,
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
      const providerVars: Record<string, string> = { ...agentCommand.env, ...customEnv };

      const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

      const resolved = resolveLocalPtySpawn({
        platform: process.platform,
        env: process.env,
        intent: {
          kind: 'run-command',
          cwd: this.taskPath,
          command: { kind: 'argv', command: agentCommand.command, args: agentCommand.args },
          shellProfile: this.shellProfile,
          shellSetup: this.shellSetup,
          tmuxSessionName,
        },
      });

      logLocalPtySpawnWarnings('LocalConversationProvider', resolved.warnings, {
        conversationId: conversation.id,
        sessionId,
      });

      const ptyId = makePtyId(conversation.providerId, conversation.id);
      const port = agentHookService.getPort();
      const token = agentHookService.getToken();
      const colorEnv = await getTerminalColorEnv();
      const pty = spawnLocalPty({
        id: sessionId,
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        env: {
          ...buildAgentEnv({
            hook: port > 0 ? { port, ptyId, token } : undefined,
            providerVars,
            shellProfile: this.shellProfile,
          }),
          ...colorEnv,
          ...this.taskEnvVars,
        },
        cols: spawnSize.cols,
        rows: spawnSize.rows,
      });

      pty.onExit((info) => {
        const decision = this.supervisor.handleExit(sessionId, pty);
        if (decision.kind === 'stale') return;
        const replacementSize = ptySessionRegistry.getLastSize(sessionId) ?? spawnSize;

        ptySessionRegistry.unregister(sessionId, { pty, exitInfo: info });
        this.sessions.delete(sessionId);
        if (decision.kind === 'stopped') return;

        events.emit(agentSessionExitedChannel, {
          conversationId: conversation.id,
          taskId: conversation.taskId,
        });

        if (this.tmux) {
          return;
        }

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
        log.warn('LocalAgentProvider: error killing PTY', {
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
        log.warn('LocalAgentProvider: error killing PTY', {
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
      this.startSessionInternal(conversation, initialSize, isResuming, undefined, true).catch(
        (e) => {
          log.error('LocalConversationProvider: replacement failed', {
            conversationId: conversation.id,
            error: String(e),
          });
        }
      );
    }, RESPAWN_DELAY_MS);
  }
}
