import { log } from '@main/lib/logger';
import { makePtySessionId, parsePtySessionId } from '@shared/ptySessionId';
import { resolveTask } from '../projects/utils';
import { ptySessionRegistry } from '../pty/pty-session-registry';

const HIDDEN_SESSION_GRACE_MS = 30_000;

export class ConversationSessionVisibilityService {
  private readonly killTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly visibleConversationsByTask = new Map<string, Set<string>>();
  private readonly trackedTasks = new Set<string>();

  updateVisibleConversations(projectId: string, taskId: string, visibleConversationIds: string[]) {
    const visible = new Set(visibleConversationIds);
    const taskKey = this.taskKey(projectId, taskId);
    this.trackedTasks.add(taskKey);
    if (visible.size === 0) {
      this.visibleConversationsByTask.delete(taskKey);
    } else {
      this.visibleConversationsByTask.set(taskKey, visible);
    }

    for (const conversationId of visible) {
      this.cancel(makePtySessionId(projectId, taskId, conversationId));
    }

    for (const { sessionId, metadata } of ptySessionRegistry.listActiveSessions()) {
      if (!metadata?.providerId) continue;
      const parsed = parsePtySessionId(sessionId);
      if (!parsed || parsed.projectId !== projectId || parsed.scopeId !== taskId) continue;
      if (visible.has(parsed.leafId)) continue;
      this.schedule(projectId, taskId, parsed.leafId, sessionId);
    }
  }

  onConversationSessionStarted(projectId: string, taskId: string, conversationId: string) {
    const taskKey = this.taskKey(projectId, taskId);
    if (!this.trackedTasks.has(taskKey)) return;

    const visible = this.visibleConversationsByTask.get(taskKey);

    const sessionId = makePtySessionId(projectId, taskId, conversationId);
    if (visible?.has(conversationId)) {
      this.cancel(sessionId);
      return;
    }

    const active = ptySessionRegistry.get(sessionId);
    const metadata = ptySessionRegistry.getMetadata(sessionId);
    if (active && metadata?.providerId) {
      this.schedule(projectId, taskId, conversationId, sessionId);
    }
  }

  private taskKey(projectId: string, taskId: string) {
    return `${projectId}:${taskId}`;
  }

  private schedule(projectId: string, taskId: string, conversationId: string, sessionId: string) {
    if (this.killTimers.has(sessionId)) return;

    const task = resolveTask(projectId, taskId);
    if (!task) return;
    const stopSession = task.conversations.stopSession.bind(task.conversations);

    const timer = setTimeout(() => {
      this.killTimers.delete(sessionId);
      const active = ptySessionRegistry.get(sessionId);
      if (!active) return;

      stopSession(conversationId).catch((error: unknown) => {
        log.warn('ConversationSessionVisibilityService: failed to stop hidden session', {
          projectId,
          taskId,
          conversationId,
          sessionId,
          error: String(error),
        });
      });
    }, HIDDEN_SESSION_GRACE_MS);

    this.killTimers.set(sessionId, timer);
  }

  private cancel(sessionId: string) {
    const timer = this.killTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.killTimers.delete(sessionId);
  }
}

export const conversationSessionVisibilityService = new ConversationSessionVisibilityService();
