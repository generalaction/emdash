import {
  automationIdSchema,
  cancelRunErrorSchema,
  cancelRunInputSchema,
  getRunInputSchema,
  getRunOverviewInputSchema,
  getRunOverviewResultSchema,
  getRunResultSchema,
  listChangedRunsInputSchema,
  listChangedRunsResultSchema,
  listRunsInputSchema,
  listRunsResultSchema,
  runEventsEventSchema,
  runReadErrorSchema,
  startRunErrorSchema,
  startRunInputSchema,
  startRunResultSchema,
} from '@emdash/core/runtimes/automations/api';
import { defineContract, eventStream, fallible, procedure } from '@emdash/wire';
import { z } from 'zod';
import {
  automationAdoptionErrorSchema,
  automationDefinitionErrorSchema,
  automationRuntimeAvailabilitySchema,
  automationSchema,
  createAutomationParamsSchema,
  updateAutomationPatchSchema,
} from '@core/primitives/automations/api';

const projectIdField = z.object({ projectId: z.string() });

export const automationsContract = defineContract({
  list: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: z.array(automationSchema),
  }),
  create: fallible({
    input: createAutomationParamsSchema,
    data: automationSchema,
    error: automationDefinitionErrorSchema,
  }),
  update: fallible({
    input: z.object({ id: z.string(), patch: updateAutomationPatchSchema }),
    data: automationSchema,
    error: automationDefinitionErrorSchema,
  }),
  delete: fallible({
    input: z.object({ automationId: z.string() }),
    data: z.void(),
    error: automationDefinitionErrorSchema,
  }),
  adoptRun: fallible({
    input: z.object({ automationId: z.string(), runId: z.string() }),
    data: z.object({ taskId: z.string(), projectId: z.string() }),
    error: automationAdoptionErrorSchema,
  }),
  getTargetAvailability: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: automationRuntimeAvailabilitySchema,
  }),
  startRun: fallible({
    input: startRunInputSchema.merge(projectIdField),
    data: startRunResultSchema,
    error: startRunErrorSchema,
  }),
  cancelRun: fallible({
    input: cancelRunInputSchema.merge(projectIdField),
    data: z.void(),
    error: cancelRunErrorSchema,
  }),
  getRun: fallible({
    input: getRunInputSchema.merge(projectIdField),
    data: getRunResultSchema,
    error: runReadErrorSchema,
  }),
  listRuns: fallible({
    input: listRunsInputSchema.merge(projectIdField),
    data: listRunsResultSchema,
    error: runReadErrorSchema,
  }),
  listChangedRuns: fallible({
    input: listChangedRunsInputSchema.merge(projectIdField),
    data: listChangedRunsResultSchema,
    error: runReadErrorSchema,
  }),
  getRunOverview: fallible({
    input: getRunOverviewInputSchema.merge(projectIdField),
    data: getRunOverviewResultSchema,
    error: runReadErrorSchema,
  }),
  runEvents: eventStream({
    key: z.object({ projectId: z.string(), automationId: automationIdSchema }),
    event: runEventsEventSchema,
  }),
});

export type AutomationsContract = typeof automationsContract;
