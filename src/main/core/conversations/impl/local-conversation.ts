import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { ProviderId } from '@shared/providers/registry';
import { makePtySessionId } from '@shared/ptySessionId';
import type {
  ConversationStartOptions,
  CreateSessionError,
  IConversationProvider,
} from '@main/core/conversations/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { Pty } from '@main/core/pty/pty';
import { buildSessionEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSpawnParams } from '@main/core/pty/spawn-utils';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ok, Result } from '@main/lib/result';
import type { AgentSessionConfig } from './agent-session';
import { wireAgentClassifier } from './shared';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class LocalConversationProvider implements IConversationProvider {
  private sessions = new Map<string, Pty>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {}

  async startSession(opts: ConversationStartOptions): Promise<Result<void, CreateSessionError>> {
    const sessionId = makePtySessionId(opts.projectId, opts.taskId, opts.conversationId);

    // Idempotent: if a live session already exists, return immediately.
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

    const env = buildSessionEnv('agent');
    const { command, args, cwd } = resolveSpawnParams('agent', cfg);

    const result = spawnLocalPty({
      id: sessionId,
      command,
      args,
      cwd,
      env,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
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

    log.info('LocalAgentProvider: session started', { sessionId, cwd });
    return ok();
  }

  stopSession(conversationId: string): void {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    const pty = this.sessions.get(sessionId);
    if (!pty) return;
    try {
      pty.kill();
    } catch (e) {
      log.warn('LocalAgentProvider: error killing PTY', { sessionId, error: String(e) });
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
