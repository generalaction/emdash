import { homedir } from 'node:os';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import type { ConversationProvider } from '@main/core/conversations/types';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { ensureGitIgnored } from '@main/core/providers/internal/gitignore';
import { createPlugin, createClassifier } from '@main/core/providers/registry';
import type { ProviderPlugin, ProviderPluginDeps } from '@main/core/providers/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { buildAgentSessionCommand } from './agent-command';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { resolveProviderEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

export class LocalConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, number>();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;
  private readonly pluginDeps: ProviderPluginDeps;
  private readonly pluginCache = new Map<string, ProviderPlugin>();
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
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;

    const projectFs = new LocalFileSystem(taskPath);
    const userFs = new LocalFileSystem(homedir());
    this.pluginDeps = {
      readProjectFile: (rel) =>
        projectFs
          .read(rel)
          .then((r) => r.content)
          .catch(() => undefined),
      writeProjectFile: async (rel, content) => void (await projectFs.write(rel, content)),
      readUserFile: (rel) =>
        userFs
          .read(rel)
          .then((r) => r.content)
          .catch(() => undefined),
      writeUserFile: async (rel, content) => void (await userFs.write(rel, content)),
      platform: process.platform,
    };
  }

  private getPlugin(providerId: Conversation['providerId']): ProviderPlugin | undefined {
    let plugin = this.pluginCache.get(providerId);
    if (!plugin) {
      plugin = createPlugin(providerId, this.pluginDeps);
      if (plugin) this.pluginCache.set(providerId, plugin);
    }
    return plugin;
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

    const plugin = this.getPlugin(conversation.providerId);
    await plugin?.prepareSession?.({ projectPath: this.taskPath, homedir: homedir() });
    const hooksAvailable = await this.prepareHookConfig(conversation.providerId, plugin);

    const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
    const { command, args } = buildAgentSessionCommand({
      providerId: conversation.providerId,
      providerConfig,
      autoApprove: conversation.autoApprove,
      sessionId: conversation.id,
      isResuming,
      initialPrompt,
    });
    const providerEnv = resolveProviderEnv(providerConfig, {
      providerId: conversation.providerId,
      autoApprove: conversation.autoApprove,
    });

    const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent: {
        kind: 'run-command',
        cwd: this.taskPath,
        command: { kind: 'argv', command, args },
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
    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildAgentEnv({
          hook: port > 0 ? { port, ptyId, token } : undefined,
          providerVars: providerEnv,
        }),
        ...this.taskEnvVars,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    const hookActive = port > 0;
    const useHooksOnly = hookActive && plugin?.supportsHooks && hooksAvailable;

    if (!useHooksOnly) {
      wireAgentClassifier({
        pty,
        classifier: createClassifier(conversation.providerId, plugin),
        providerId: conversation.providerId,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });
    }

    pty.onExit(({ exitCode }) => {
      ptySessionRegistry.unregister(sessionId);
      const shouldRespawn = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
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
          log.error('LocalConversationProvider: respawn limit reached, giving up', {
            conversationId: conversation.id,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        const resumeNext = isResuming && count <= MAX_RESPAWNS;
        if (count > MAX_RESPAWNS) this.respawnCounts.set(sessionId, 0);

        setTimeout(() => {
          this.startSession(conversation, initialSize, resumeNext, initialPrompt).catch((e) => {
            log.error('LocalConversationProvider: respawn failed', {
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
    scheduleInitialPromptInjection({ pty, conversation, initialPrompt, isResuming });
    telemetryService.capture('agent_run_started', {
      provider: conversation.providerId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
  }

  private async prepareHookConfig(
    providerId: Conversation['providerId'],
    plugin: ProviderPlugin | undefined
  ): Promise<boolean> {
    if (!plugin?.writeHookConfig) return false;
    try {
      const localProjectSettings = await appSettingsService.get('localProject');
      const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;
      const previous = this.preparedHookProviders.get(providerId);
      const shouldPrepare =
        previous === undefined || (!previous.writeGitIgnoreEntries && writeGitIgnoreEntries);
      if (!shouldPrepare) return previous?.hooksAvailable ?? false;

      const providerDef = getProvider(providerId);
      const cliFound = providerDef?.cli
        ? await resolveCommandPath(providerDef.cli, this.ctx).then(Boolean)
        : false;

      let hooksAvailable = false;
      if (cliFound) {
        hooksAvailable = await plugin.writeHookConfig();
        if (hooksAvailable && writeGitIgnoreEntries && plugin.gitIgnorePaths?.length) {
          await ensureGitIgnored(
            this.pluginDeps.readProjectFile,
            this.pluginDeps.writeProjectFile,
            plugin.gitIgnorePaths
          );
        }
      }

      this.preparedHookProviders.set(providerId, { writeGitIgnoreEntries, hooksAvailable });
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

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('LocalAgentProvider: error killing PTY', { sessionId, error: String(e) });
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
