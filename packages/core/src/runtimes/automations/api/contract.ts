import { defineContract, eventStream, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
  cancelRunErrorSchema,
  deployErrorSchema,
  runReadErrorSchema,
  removeErrorSchema,
  startRunErrorSchema,
} from './errors';
import {
  cancelRunInputSchema,
  deployInputSchema,
  deployResultSchema,
  getRunInputSchema,
  getRunOverviewInputSchema,
  getRunOverviewResultSchema,
  getRunResultSchema,
  listChangedRunsInputSchema,
  listChangedRunsResultSchema,
  listRunsInputSchema,
  listRunsResultSchema,
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
  getRun: fallible({
    input: getRunInputSchema,
    data: getRunResultSchema,
    error: runReadErrorSchema,
  }),
  listRuns: fallible({
    input: listRunsInputSchema,
    data: listRunsResultSchema,
    error: runReadErrorSchema,
  }),
  listChangedRuns: fallible({
    input: listChangedRunsInputSchema,
    data: listChangedRunsResultSchema,
    error: runReadErrorSchema,
  }),
  getRunOverview: fallible({
    input: getRunOverviewInputSchema,
    data: getRunOverviewResultSchema,
    error: runReadErrorSchema,
  }),
  runEvents: eventStream({
    key: runEventsKeySchema,
    event: runEventsEventSchema,
  }),
})

export type AutomationsContract = typeof automationsContract;
