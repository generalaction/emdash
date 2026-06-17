import { and, eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { killSessionById } from '@main/core/pty/multiplexer';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
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

  const task = resolveTask(projectId, taskId);
  if (task) {
    await task.conversations.stopSession(conversationId);
  } else {
    const project = projectManager.getProject(projectId);
    if (project) {
      await killSessionById({
        hostCtx: project.ctx,
        kind: 'agent',
        sessionId: makePtySessionId(projectId, taskId, conversationId),
      });
    }
  }
  telemetryService.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
