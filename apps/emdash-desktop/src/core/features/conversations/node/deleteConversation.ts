import { and, eq } from 'drizzle-orm';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { enqueueConversationDeletion } from '@core/features/conversations/api/node/operations/conversation-removal';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import type { OperationSubmitter } from '@core/services/operations/api/node';

/**
 * User-initiated conversation deletion, host-resident shape (spec §4.3): enqueues the
 * durable `host-delete-conversation` outbox verb — which kills any live session as part of
 * the verb and deletes the index record — with the registry row untracked as the tombstone.
 * A delete issued while the host sleeps executes on reconnect.
 */
export async function deleteConversation(
  db: AppDb,
  operations: OperationSubmitter,
  projectId: string,
  taskId: string,
  conversationId: string,
  telemetry: Pick<TelemetryService, 'capture'>
): Promise<void> {
  const [convRow] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId),
        liveConversations()
      )
    )
    .limit(1);
  // Idempotent toward the caller: an already-deleted (or already-pending) row is a no-op.
  if (!convRow) return;

  const enqueued = await enqueueConversationDeletion(operations, conversationId);
  if (!enqueued.success) {
    throw new Error(`Failed to enqueue conversation deletion: ${enqueued.error.message}`);
  }

  conversationEvents._emit('conversation:deleted', conversationId);
  appDbPokes.conversations.poke({ projectId, taskId });
  telemetry.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
