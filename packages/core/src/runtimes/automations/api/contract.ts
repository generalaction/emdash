import { defineContract, eventStream, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
  deployErrorSchema,
  getRunsErrorSchema,
  removeErrorSchema,
  startRunErrorSchema,
  stopRunErrorSchema,
} from './errors';
import {
  deployInputSchema,
  deployResultSchema,
  getRunsInputSchema,
  getRunsResultSchema,
  removeInputSchema,
  runEventsEventSchema,
  runEventsKeySchema,
  startRunInputSchema,
  startRunResultSchema,
  stopRunInputSchema,
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
  stopRun: fallible({
    input: stopRunInputSchema,
    data: z.void(),
    error: stopRunErrorSchema,
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
