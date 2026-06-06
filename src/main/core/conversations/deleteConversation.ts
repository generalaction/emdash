import { and, eq } from 'drizzle-orm';
import { codexChatService } from '@main/core/codex-chat/codex-chat-service';
import { projectManager } from '@main/core/projects/project-manager';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { makePtySessionId } from '@shared/ptySessionId';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';

export async function deleteConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    );

  conversationEvents._emit('conversation:deleted', conversationId);

  // No-op for terminal-mode conversations; kills any running native turn.
  await codexChatService.dispose(conversationId);

  const task = resolveTask(projectId, taskId);
  if (task) {
    await task.conversations.stopSession(conversationId);
  } else {
    const project = projectManager.getProject(projectId);
    if (project) {
      await killTmuxSession(
        project.ctx,
        makeTmuxSessionName(makePtySessionId(projectId, taskId, conversationId))
      );
    }
  }
  telemetryService.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
