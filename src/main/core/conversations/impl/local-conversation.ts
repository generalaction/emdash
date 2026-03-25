import { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import type { ConversationProvider } from '@main/core/conversations/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { agentEventService } from '@main/services/AgentEventService';
import { buildAgentCommand, wireAgentClassifier } from './shared';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class LocalConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;

  constructor({
    projectId,
    taskPath,
    taskId,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
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

    const { command, args } = await buildAgentCommand({
      providerId: conversation.providerId,
      autoApprove: conversation.autoApprove,
      sessionId: conversation.id,
      isResuming,
      initialPrompt,
    });

    const ptyId = makePtyId(conversation.providerId, conversation.id);
    const port = agentEventService.getPort();
    const token = agentEventService.getToken();
    const pty = spawnLocalPty({
      id: sessionId,
      command,
      args,
      cwd: this.taskPath,
      env: buildAgentEnv({
        hook: port > 0 ? { port, ptyId, token } : undefined,
      }),
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    wireAgentClassifier({
      pty,
      providerId: conversation.providerId,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    });

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
      if (shouldRespawn) {
        setTimeout(() => {
          this.startSession(conversation, initialSize, isResuming, initialPrompt).catch((e) => {
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
  }

  async stopSession(conversationId: string): Promise<void> {
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
