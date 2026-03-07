import { Pty } from '@/_new/pty/pty';
import { AgentStartOptions, CreateSessionError, IAgentProvider } from '../../agent-provider';
import type { SshClientProxy } from '../../../ssh/ssh-client-proxy';
import { ok, Result } from '@/_new/lib/result';
import { makePtySessionId } from '@shared/ptySessionId';
import { AgentSessionConfig } from '@/_new/environment/impl/agent-provider/agent-session';
import { ProviderId } from '@shared/providers/registry';
import { buildSshCommandString, resolveSpawnParams } from '@/_new/pty/spawn-utils';
import { openSsh2Pty } from '@/_new/pty/ssh2-pty';
import { wireAgentClassifier } from './shared';
import { events } from '@/_new/lib/events';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { ptySessionRegistry } from '@/_new/pty/pty-session-registry';
import { log } from '@/_new/lib/logger';

export class SshAgentProvider implements IAgentProvider {
  private sessions = new Map<string, Pty>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly proxy: SshClientProxy
  ) {}

  async startSession(opts: AgentStartOptions): Promise<Result<void, CreateSessionError>> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.conversationId);

    if (this.sessions.has(sessionId)) return ok();

    const cfg: AgentSessionConfig = {
      taskId: opts.taskId,
      conversationId: opts.conversationId,
      providerId: opts.providerId as ProviderId,
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
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

  stopSession(conversationId: string): void {
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

  destroyAll(): void {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
