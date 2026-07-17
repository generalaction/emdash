import { defineContract, eventStream, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
  cancelRunErrorSchema,
  deployErrorSchema,
  getRunsErrorSchema,
  removeErrorSchema,
  startRunErrorSchema,
} from './errors';
import {
  cancelRunInputSchema,
  deployInputSchema,
  deployResultSchema,
  getRunsInputSchema,
  getRunsResultSchema,
  removeInputSchema,
  runEventsEventSchema,
  runEventsKeySchema,
  startRunInputSchema,
  startRunResultSchema,
} from './schemas';

export const automationsContract = defineContract({
  deploy: fallible({
    input: deployInputSchema,
    data: deployResultSchema,
    error: deployErrorSchema,
  }),
  remove: fallible({
    input: removeInputSchema,
    data: z.void(),
    error: removeErrorSchema,
  }),
  startRun: fallible({
    input: startRunInputSchema,
    data: startRunResultSchema,
    error: startRunErrorSchema,
  }),
  cancelRun: fallible({
    input: cancelRunInputSchema,
    data: z.void(),
    error: cancelRunErrorSchema,
  }),
  getRuns: fallible({
    input: getRunsInputSchema,
    data: getRunsResultSchema,
    error: getRunsErrorSchema,
  }),
  runEvents: eventStream({
    key: runEventsKeySchema,
    event: runEventsEventSchema,
  }),
});

export type AutomationsContract = typeof automationsContract;
