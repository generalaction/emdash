import { and, eq } from 'drizzle-orm';
import { acpSessionManager } from '@main/core/acp/acp-session-manager';
import { projectManager } from '@main/core/projects/project-manager';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

export async function deleteConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

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

  if (row) {
    const conversation = mapConversationRowToConversation(row);
    if (conversation.type === 'acp') {
      acpSessionManager.stop(conversationId);
      telemetryService.capture('conversation_deleted', {
        project_id: projectId,
        task_id: taskId,
        conversation_id: conversationId,
      });
      return;
    }
  }

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
