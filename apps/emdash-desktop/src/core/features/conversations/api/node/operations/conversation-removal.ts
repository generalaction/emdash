import { randomUUID } from 'node:crypto';
import { formatHostRef, hostRefFromParts } from '@emdash/core/primitives/host/api';
import { hostDeleteConversationOperation } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import type { HostDeleteConversationInput } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import type { ConversationRow } from '@core/services/app-db/node/schema';
import { enqueueTombstoned, type OperationSubmitter } from '@core/services/operations/api/node';

/**
 * Enqueues user-initiated conversation deletion as a durable Host operation
 * (spec §4.3): the registry row is untracked as the tombstone (removal-pending
 * presentation follows the workspace-removal precedent), and the outbox entry
 * carries the verb until the host executes it — on reconnect if necessary.
 */
export async function enqueueConversationDeletion(
  operations: OperationSubmitter,
  conversationId: string
) {
  const createdAt = Date.now();
  const registry = createConversationRegistry(operations.db);
  return enqueueTombstoned(operations, {
    definition: hostDeleteConversationOperation,
    load: () => registry.getLive(conversationId),
    notFound: () => ({
      type: 'conversation-not-found',
      message: `Conversation ${conversationId} was not found`,
    }),
    buildInput: (row) => compileConversationDeletionInput(row, createdAt),
    tombstone: (tx, row) => registry.untrack([row.id], new Date(createdAt).toISOString(), tx),
    revert: (tx, row) => {
      registry.revertUntrack([row.id], tx);
    },
    poke: (row) =>
      appDbPokes.conversations.poke({
        projectId: row.projectId ?? undefined,
        taskId: row.taskId ?? undefined,
      }),
  });
}

/**
 * Snapshot-compiles the delete verb input from a registry row. Used at enqueue time — the
 * mirror row may be gone (task-row FK cascade) by the time the handler runs, so the input
 * must carry everything.
 */
export function compileConversationDeletionInput(
  row: Pick<
    ConversationRow,
    'id' | 'title' | 'projectId' | 'taskId' | 'location' | 'sshConnectionId'
  >,
  createdAt: number
): HostDeleteConversationInput {
  return {
    version: '1',
    source: 'user',
    hostOperationId: randomUUID(),
    hostRef: formatHostRef(hostRefFromParts(row.location, row.sshConnectionId)),
    conversationId: row.id,
    projectId: row.projectId ?? undefined,
    taskId: row.taskId ?? undefined,
    entityName: row.title || undefined,
    createdAt,
  };
}
