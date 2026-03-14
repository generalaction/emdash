import { ProviderId } from '@shared/agent-provider-registry';
import { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type {
  ConversationProvider,
  ConversationStartOptions,
  CreateSessionError,
} from '@main/core/conversations/types';
import { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { buildSshCommandString, resolveSpawnParams } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ok, Result } from '@main/lib/result';
import type { AgentSessionConfig } from './agent-session';
import { wireAgentClassifier } from './shared';

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly proxy: SshClientProxy
  ) {}

  async startSession(conversation: Conversation): Promise<void> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.conversationId);

    if (this.sessions.has(sessionId)) return ok();

    const cfg: AgentSessionConfig = {
      taskId: opts.taskId,
      conversationId: opts.conversationId,
      providerId: opts.providerId as ProviderId,
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      sessionId: opts.agentSessionId,
      shellSetup: opts.shellSetup,
      tmuxSessionName: opts.tmuxSessionName,
      autoApprove: opts.autoApprove ?? false,
      resume: opts.resume ?? false,
    };

    const { command, args, cwd } = resolveSpawnParams('agent', cfg);
    const sshCommand = buildSshCommandString(command, args, cwd);

    const result = await openSsh2Pty(this.proxy.client, {
      id: sessionId,
      command: sshCommand,
      cols: 80,
      rows: 24,
    });

    if (!result.success) return result;

    const pty = result.data;

    wireAgentClassifier(pty, sessionId, cfg);

    pty.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId);
      events.emit(
        agentSessionExitedChannel,
        { sessionId, conversationId: cfg.conversationId, taskId: cfg.taskId, exitCode },
        cfg.taskId
      );
    });

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);

    log.info('SshAgentProvider: session started', { sessionId, cwd });
    return ok();
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
  }

  async destroyAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
