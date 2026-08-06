import { defineContract, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  conversationReportErrorSchema,
  reportProviderSessionIdInputSchema,
  reportSessionActivityInputSchema,
  reportSessionEndedInputSchema,
  reportSessionStartedInputSchema,
} from './schemas';

/**
 * The lifecycle-report subset of the conversations index contract (spec §3.3): the surface
 * session runtimes depend on to report facts into the sole-writer index. Structurally a
 * subset of `conversationsContract`, so the full conversations client satisfies it — the
 * session-start-contract pattern.
 */
export const conversationReportsContract = defineContract({
  reportSessionStarted: fallible({
    input: reportSessionStartedInputSchema,
    data: z.void(),
    error: conversationReportErrorSchema,
  }),
  reportProviderSessionId: fallible({
    input: reportProviderSessionIdInputSchema,
    data: z.void(),
    error: conversationReportErrorSchema,
  }),
  reportSessionActivity: fallible({
    input: reportSessionActivityInputSchema,
    data: z.void(),
    error: conversationReportErrorSchema,
  }),
  reportSessionEnded: fallible({
    input: reportSessionEndedInputSchema,
    data: z.void(),
    error: conversationReportErrorSchema,
  }),
});

export type ConversationReportsContract = typeof conversationReportsContract;
