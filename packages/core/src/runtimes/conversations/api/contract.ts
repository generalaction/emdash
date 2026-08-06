import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
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
  reportProviderSessionIdInputSchema,
  reportSessionActivityInputSchema,
  reportSessionEndedInputSchema,
  reportSessionStartedInputSchema,
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

  // Lifecycle reports — the second feeder (spec §3.3). One-way, same-host calls from the
  // session runtimes; the index stamps observation times with its own clock. Reports never
  // create records: a report against a deleted record is a not-found error the feeder logs.
  reportSessionStarted: fallible({
    input: reportSessionStartedInputSchema,
    data: z.void(),
    error: conversationMutationErrorSchema,
  }),
  reportProviderSessionId: fallible({
    input: reportProviderSessionIdInputSchema,
    data: z.void(),
    error: conversationMutationErrorSchema,
  }),
  reportSessionActivity: fallible({
    input: reportSessionActivityInputSchema,
    data: z.void(),
    error: conversationMutationErrorSchema,
  }),
  reportSessionEnded: fallible({
    input: reportSessionEndedInputSchema,
    data: z.void(),
    error: conversationMutationErrorSchema,
  }),
});

export type ConversationsContract = typeof conversationsContract;
