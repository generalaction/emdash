import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { enqueueConversationDeletion } from '@core/features/conversations/api/node/operations/conversation-removal';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { OperationSubmitter } from '@core/services/operations/api/node';

/**
 * The machine page's per-record delete (spec §8): the same durable outbox verb as
 * task-scoped deletion, but link-free — orphaned and task-linked records alike are
 * deletable from the discovery surface by id alone.
 */
export async function deleteHostConversation(
  operations: OperationSubmitter,
  conversationId: string,
  telemetry: Pick<TelemetryService, 'capture'>
): Promise<void> {
  const enqueued = await enqueueConversationDeletion(operations, conversationId);
  if (!enqueued.success) {
    // Idempotent toward the caller: an absent or already-pending row is a no-op.
    if (enqueued.error.type === 'conversation-not-found') return;
    throw new Error(`Failed to enqueue conversation deletion: ${enqueued.error.message}`);
  }

  conversationEvents._emit('conversation:deleted', conversationId);
  telemetry.capture('conversation_deleted', { conversation_id: conversationId });
}
