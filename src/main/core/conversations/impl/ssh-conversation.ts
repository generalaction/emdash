import type { AgentSessionConfig } from '@shared/agent-session';
import { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import type { ConversationProvider } from '@main/core/conversations/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import type { ExecFn } from '@main/core/utils/exec';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import { buildAgentCommand } from './agent-command';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private respawnCounts = new Map<string, number>();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean = false;
  private readonly shellSetup?: string;
  private readonly exec: ExecFn;
  private readonly proxy: SshClientProxy;

  constructor({
    projectId,
    taskPath,
    taskId,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    exec,
    proxy,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    exec: ExecFn;
    proxy: SshClientProxy;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.exec = exec;
    this.proxy = proxy;
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

    if (this.sessions.has(sessionId)) return;

    await claudeTrustService.maybeAutoTrustSsh({
      providerId: conversation.providerId,
      cwd: this.taskPath,
      exec: this.exec,
      remoteFs: new SshFileSystem(this.proxy, '/'),
    });

    const { command, args } = await buildAgentCommand({
      providerId: conversation.providerId,
      autoApprove: conversation.autoApprove,
      sessionId: conversation.id,
      isResuming,
      initialPrompt,
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
      resume: isResuming,
    };

    const sshCommand = resolveSshCommand('agent', cfg, this.taskEnvVars);

    const result = await openSsh2Pty(this.proxy.client, {
      id: sessionId,
      command: sshCommand,
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (!result.success) {
      log.error('SshConversationProvider: failed to open SSH channel', {
        sessionId,
        error: result.error.message,
      });
      return;
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

    const startedAt = Date.now();
    pty.onExit(({ exitCode }) => {
      ptySessionRegistry.unregister(sessionId);
      const shouldRespawn = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      capture('agent_run_finished', {
        provider: conversation.providerId,
        duration_ms: Math.max(0, Date.now() - startedAt),
        exit_code: typeof exitCode === 'number' ? exitCode : -1,
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

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);
    capture('agent_run_started', { provider: conversation.providerId });
  }

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    const pty = this.sessions.get(sessionId);
    if (!pty) return;
    try {
      pty.kill();
    } catch (e) {
      log.warn('SshAgentProvider: error killing PTY', { sessionId, error: String(e) });
    }
    this.sessions.delete(sessionId);
    ptySessionRegistry.unregister(sessionId);
    if (this.tmux) {
      await killTmuxSession(this.exec, makeTmuxSessionName(sessionId));
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(
        sessionIds.map((id) => killTmuxSession(this.exec, makeTmuxSessionName(id)))
      );
    }
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
