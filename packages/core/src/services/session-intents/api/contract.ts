import { defineContract, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
  sessionIntentDeleteInputSchema,
  sessionIntentErrorSchema,
  sessionIntentListInputSchema,
  sessionIntentSchema,
  sessionIntentSetStatusInputSchema,
  sessionIntentUpsertInputSchema,
} from './schemas';

export const sessionIntentsContract = defineContract({
  list: fallible({
    input: sessionIntentListInputSchema,
    data: z.array(sessionIntentSchema),
    error: sessionIntentErrorSchema,
  }),
  upsert: fallible({
    input: sessionIntentUpsertInputSchema,
    data: z.void(),
    error: sessionIntentErrorSchema,
  }),
  setStatus: fallible({
    input: sessionIntentSetStatusInputSchema,
    data: z.void(),
    error: sessionIntentErrorSchema,
  }),
  delete: fallible({
    input: sessionIntentDeleteInputSchema,
    data: z.void(),
    error: sessionIntentErrorSchema,
  }),
});

export type SessionIntentsContract = typeof sessionIntentsContract;
