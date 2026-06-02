import { homedir } from 'node:os';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { HookConfigWriter } from '@main/core/agent-hooks/hook-config';
import { workspaceTrustService } from '@main/core/agent-hooks/workspace-trust-service';
import { ConversationSessionSupervisor } from '@main/core/conversations/conversation-session-supervisor';
import { resolveAgentSessionCommandArgs } from '@main/core/conversations/resolve-agent-session-command';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { buildAgentSessionCommand } from './agent-command';
import { syncGrokThemeWithAppTheme } from './grok-theme-config';
import { createInitialPromptDelivery } from './initial-prompt-delivery';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { resolveProviderEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const RESPAWN_DELAY_MS = 500;

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
  private readonly hookConfigWriter: HookConfigWriter;
  private readonly preparedHookProviders = new Map<
    string,
    { writeGitIgnoreEntries: boolean; hooksAvailable: boolean }
  >();

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
    this.hookConfigWriter = new HookConfigWriter(new LocalFileSystem(taskPath), ctx);
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
    const spawnToken = this.supervisor.beginStart(sessionId, { requireDesired });
    if (!spawnToken) return;

    try {
      await workspaceTrustService.maybeAutoTrustLocal({
        providerId: conversation.providerId,
        cwd: this.taskPath,
        homedir: homedir(),
        force: conversation.autoApprove === true,
      });
      const hooksAvailable = await this.prepareHookConfig(conversation.providerId);

      const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
      const providerDef = getProvider(conversation.providerId);
      const agentSession = resolveAgentSessionCommandArgs(conversation, isResuming);
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
      if (conversation.providerId === 'grok') {
        await syncGrokThemeWithAppTheme({ env: providerEnv });
      }

      const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

      const resolved = resolveLocalPtySpawn({
        platform: process.platform,
        env: process.env,
        intent: {
          kind: 'run-command',
          cwd: this.taskPath,
          command: { kind: 'argv', command, args },
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
      const hookActive = port > 0;
      const ampHooksAvailable =
        hookActive &&
        conversation.providerId === 'amp' &&
        providerDef?.supportsHooks &&
        hooksAvailable;
      const pty = spawnLocalPty({
        id: sessionId,
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        env: {
          ...buildAgentEnv({
            hook: port > 0 ? { port, ptyId, token } : undefined,
            providerVars: providerEnv,
            shellProfile: this.shellProfile,
          }),
          ...this.taskEnvVars,
          ...(ampHooksAvailable && !this.taskEnvVars['PLUGINS'] ? { PLUGINS: 'all' } : {}),
        },
        cols: spawnSize.cols,
        rows: spawnSize.rows,
      });

      /*
       * Codex hooks can be skipped by the CLI in some live-session edge cases.
       * Amp hooks only cover lifecycle events today, and Grok hook emission is
       * still early-beta. Kimi hooks include the needed lifecycle events, but
       * the new CLI/docs are still changing. Keep the output classifier active
       * as a fallback so the UI can leave "working" and catch prompts.
       */
      const useHooksOnly =
        hookActive &&
        providerDef?.supportsHooks &&
        hooksAvailable &&
        conversation.providerId !== 'codex' &&
        conversation.providerId !== 'grok' &&
        conversation.providerId !== 'kimi' &&
        conversation.providerId !== 'amp';

      if (!useHooksOnly) {
        wireAgentClassifier({
          pty,
          providerId: conversation.providerId,
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
        });
      }

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

        if (decision.kind === 'failed') {
          return;
        }

        if (this.tmux) {
          return;
        }

        if (this.supervisor.isDesired(sessionId)) {
          this.scheduleReplacement({
            conversation,
            initialSize: replacementSize,
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

  private async prepareHookConfig(providerId: Conversation['providerId']): Promise<boolean> {
    try {
      const localProjectSettings = await appSettingsService.get('localProject');
      const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;
      const previous = this.preparedHookProviders.get(providerId);
      const shouldPrepareHookConfig =
        previous === undefined || (!previous.writeGitIgnoreEntries && writeGitIgnoreEntries);
      if (!shouldPrepareHookConfig) return previous?.hooksAvailable ?? false;

      const hooksAvailable = await this.hookConfigWriter.writeForProvider(providerId, {
        writeGitIgnoreEntries,
      });
      this.preparedHookProviders.set(providerId, {
        writeGitIgnoreEntries,
        hooksAvailable,
      });
      return hooksAvailable;
    } catch (error) {
      log.warn('LocalConversationProvider: failed to prepare hook config', {
        providerId,
        taskPath: this.taskPath,
        error: String(error),
      });
      return false;
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
  }: {
    conversation: Conversation;
    initialSize: { cols: number; rows: number };
  }): void {
    setTimeout(() => {
      this.startSessionInternal(conversation, initialSize, true, undefined, true).catch((e) => {
        log.error('LocalConversationProvider: replacement failed', {
          conversationId: conversation.id,
          error: String(e),
        });
      });
    }, RESPAWN_DELAY_MS);
  }
}
