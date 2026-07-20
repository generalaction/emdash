import { killTmuxSession, makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq } from 'drizzle-orm';
import { makePtySessionId } from '@core/primitives/pty/api';
import { conversations } from '@core/services/app-db/node/schema';
import { projectManager } from '@main/core/projects/project-manager';
import { getAppDb } from '@main/db/instance';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';

export async function deleteConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [convRow] = await getAppDb()
    .select({ type: conversations.type })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  await getAppDb()
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    );

  conversationEvents._emit('conversation:deleted', conversationId);

  if (convRow?.type === 'acp') {
    telemetryService.capture('conversation_deleted', {
      project_id: projectId,
      task_id: taskId,
      conversation_id: conversationId,
    });
    return;
  }

  const task = resolveTask(projectId, taskId);
  if (task) {
    await task.conversations.deleteSession(conversationId);
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
