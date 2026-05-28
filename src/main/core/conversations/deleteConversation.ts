import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events as ipcEvents } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
import { conversationDeletedChannel } from '@shared/events/conversationEvents';
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
  ipcEvents.emit(conversationDeletedChannel, { projectId, taskId, conversationId });

  const task = resolveTask(projectId, taskId);
  await task?.conversations.stopSession(conversationId);
  telemetryService.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
