import { defineContract, eventStream, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
    automationDeploymentErrorSchema,
  automationRemoveErrorSchema,
  getRunsErrorSchema,
  startRunErrorSchema,
  stopRunErrorSchema,
} from './errors';
import {
    automationDeploymentResultSchema,
  automationRemoveInputSchema,
  getRunsInputSchema,
  getRunsResultSchema,
  runEventsEventSchema,
  runEventsKeySchema,
  startRunInputSchema,
  startRunResultSchema,
  stopRunInputSchema,
} from './schemas';
import { automationDeploymentSchema } from './deployment';

export const automationsContract = defineContract({
  deploy: fallible({
    input: automationDeploymentSchema,
    data: automationDeploymentResultSchema,
    error: automationDeploymentErrorSchema,
  }),
  remove: fallible({
    input: automationRemoveInputSchema,
    data: z.void(),
    error: automationRemoveErrorSchema,
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
