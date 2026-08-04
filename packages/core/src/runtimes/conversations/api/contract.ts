import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  conversationMutationErrorSchema,
  createConversationErrorSchema,
  deleteConversationErrorSchema,
} from './errors';
import {
  conversationRecordSchema,
  conversationRecordsSchema,
  createConversationInputSchema,
  deleteConversationInputSchema,
  renameConversationInputSchema,
  updateConversationConfigInputSchema,
} from './schemas';

/**
 * The host conversation index (spec §4). The `records` live model is the sole read path —
 * durable-backed, so subscribing yields every durable record whether or not a session is
 * live; the initial state on subscribe is the authoritative snapshot. Mutations are the
 * client-facing feeder of the sole-writer index component (conv.sole-writer).
 */
export const conversationsContract = defineContract({
  records: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: conversationRecordsSchema }),
    },
  }),
  create: fallible({
    input: createConversationInputSchema,
    data: conversationRecordSchema,
    error: createConversationErrorSchema,
  }),
  rename: fallible({
    input: renameConversationInputSchema,
    data: conversationRecordSchema,
    error: conversationMutationErrorSchema,
  }),
  updateConfig: fallible({
    input: updateConversationConfigInputSchema,
    data: conversationRecordSchema,
    error: conversationMutationErrorSchema,
  }),
  delete: fallible({
    input: deleteConversationInputSchema,
    data: z.void(),
    error: deleteConversationErrorSchema,
  }),
});

export type ConversationsContract = typeof conversationsContract;
