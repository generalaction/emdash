import { serializedHostRefSchema } from '@emdash/core/primitives/host/api';
import { defineOperation } from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';
import { conversationKernelResource } from '@core/primitives/operations/api/resources';
import { operationErrorSchema, operationResultSchema } from '@core/services/operations/node';

/**
 * Conversation deletion as a durable Host operation (spec §4.3): the desktop record is the
 * outbox entry; the dispatch gate defers execution while the host is offline, and the
 * handler kills any live session as part of the verb, then deletes the index record.
 * All identity is snapshot into the input at enqueue time — the client mirror row may be
 * FK-cascaded away (task deletion) before the handler runs.
 */
const hostDeleteConversationInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      /** Desktop-minted UUID; the idempotency key toward the host. */
      hostOperationId: z.string().min(1),
      /** Canonical serialized HostRef of the conversation's source host. */
      hostRef: serializedHostRefSchema,
      conversationId: z.string().min(1),
      projectId: z.string().optional(),
      taskId: z.string().optional(),
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type HostDeleteConversationInput = typeof hostDeleteConversationInputSchema.Type;

export const hostDeleteConversationOperation = defineOperation({
  name: 'host-delete-conversation',
  input: hostDeleteConversationInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `outbox:delete-conversation:${input.hostRef}:${input.conversationId}`,
  claims: (input) => conversationKernelResource.mutates({ conversationId: input.conversationId }),
  describe: (input) => input.entityName ?? input.conversationId,
  retry: {
    maxAttempts: 5,
    backoff: { kind: 'exponential', baseMs: 2_000, maxMs: 60_000 },
  },
});
