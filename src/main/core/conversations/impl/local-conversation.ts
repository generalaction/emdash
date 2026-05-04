import { homedir } from 'node:os';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { HookConfigWriter } from '@main/core/agent-hooks/hook-config';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { buildAgentCommand } from './agent-command';

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
  private readonly hookConfigWriter: HookConfigWriter;
  private readonly preparedHookProviders = new Map<string, boolean>();

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
    this.hookConfigWriter = new HookConfigWriter(new LocalFileSystem(taskPath), ctx);
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

    await claudeTrustService.maybeAutoTrustLocal({
      providerId: conversation.providerId,
      cwd: this.taskPath,
      homedir: homedir(),
    });
    await this.prepareHookConfig(conversation.providerId);

    const { command, args } = await buildAgentCommand({
      providerId: conversation.providerId,
      autoApprove: conversation.autoApprove,
      sessionId: conversation.id,
      isResuming,
      initialPrompt,
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
        }),
        ...this.taskEnvVars,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    const hookActive = port > 0;
    const provider = getProvider(conversation.providerId);
    const useHooksOnly = hookActive && provider?.supportsHooks;

    if (!useHooksOnly) {
      wireAgentClassifier({
        pty,
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

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);
    telemetryService.capture('agent_run_started', {
      provider: conversation.providerId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
  }

  private async prepareHookConfig(providerId: Conversation['providerId']): Promise<void> {
    try {
      const localProjectSettings = await appSettingsService.get('localProject');
      const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;
      const previousWriteGitIgnoreEntries = this.preparedHookProviders.get(providerId);
      const shouldPrepareHookConfig =
        previousWriteGitIgnoreEntries === undefined ||
        (!previousWriteGitIgnoreEntries && writeGitIgnoreEntries);
      if (!shouldPrepareHookConfig) return;

      await this.hookConfigWriter.writeForProvider(providerId, {
        writeGitIgnoreEntries,
      });
      this.preparedHookProviders.set(providerId, writeGitIgnoreEntries);
    } catch (error) {
      log.warn('LocalConversationProvider: failed to prepare hook config', {
        providerId,
        taskPath: this.taskPath,
        error: String(error),
      });
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
