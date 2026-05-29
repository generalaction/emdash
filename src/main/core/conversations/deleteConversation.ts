import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
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

  const releaseBackendExitSuppression =
    chatConversationRuntime.suppressBackendExitDuringStop(conversationId);
  const task = resolveTask(projectId, taskId);
  try {
    await task?.conversations.stopSession(conversationId);
  } catch (error) {
    log.warn('deleteConversation: failed to stop deleted conversation backend', {
      conversationId,
      error: String(error),
    });
  } finally {
    releaseBackendExitSuppression();
  }

  try {
    await chatConversationRuntime.cancelPendingPermissionRequestsForConversation(conversationId);
    await chatConversationRuntime.dehydrateConversation(conversationId, {
      restoreHydrationRecovery: false,
    });
  } catch (error) {
    log.warn('deleteConversation: failed to clean up deleted conversation runtime', {
      conversationId,
      error: String(error),
    });
  }

  conversationEvents._emit('conversation:deleted', conversationId);

  telemetryService.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
