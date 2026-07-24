import { z } from 'zod';
import { automationDeploymentSchema, automationIdSchema } from './deployment';
import { automationRunIdSchema, automationRunSchema, automationRunStatusSchema } from './run';

export const LIST_RUNS_DEFAULT_LIMIT = 50;
export const LIST_RUNS_MAX_LIMIT = 200;
export const LIST_CHANGED_RUNS_DEFAULT_LIMIT = 200;
export const LIST_CHANGED_RUNS_MAX_LIMIT = 1_000;

export const deployInputSchema = automationDeploymentSchema;

export const deployResultSchema = z.object({
  deployment: automationDeploymentSchema,
  deployedAt: z.number().int().nonnegative(),
});

export const removeInputSchema = z.object({
  automationId: automationIdSchema,
});

export const startRunInputSchema = z.object({
  automationId: automationIdSchema,
});

export const startRunResultSchema = z.object({
  run: automationRunSchema,
});

export const cancelRunInputSchema = z.object({
  automationId: automationIdSchema,
  runId: automationRunIdSchema,
});

export const getRunInputSchema = z.object({
  automationId: automationIdSchema,
  runId: automationRunIdSchema,
});

export const getRunResultSchema = z.object({
  run: automationRunSchema.nullable(),
});

export const listRunsInputSchema = z.object({
  automationId: automationIdSchema,
  status: automationRunStatusSchema.optional(),
  before: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(LIST_RUNS_MAX_LIMIT).optional(),
});

export const listRunsResultSchema = z.object({
  runs: z.array(automationRunSchema).max(LIST_RUNS_MAX_LIMIT),
});

export const listChangedRunsInputSchema = z.object({
  automationId: automationIdSchema,
  sinceSeq: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(LIST_CHANGED_RUNS_MAX_LIMIT).optional(),
});

export const listChangedRunsResultSchema = z.object({
  runs: z.array(automationRunSchema).max(LIST_CHANGED_RUNS_MAX_LIMIT),
  nextSeq: z.number().int().nonnegative(),
});

export const getRunOverviewInputSchema = z.object({
  automationId: automationIdSchema,
});

export const runStatusCountsSchema = z.record(
  automationRunStatusSchema,
  z.number().int().nonnegative()
);

export const getRunOverviewResultSchema = z.object({
  counts: runStatusCountsSchema,
  latestRun: automationRunSchema.nullable(),
  nextScheduledRun: automationRunSchema.nullable(),
});

export const runEventsKeySchema = z.object({
  automationId: automationIdSchema.optional(),
});

export const runEventsEventSchema = z.object({
  run: automationRunSchema,
});

export type DeployInput = z.infer<typeof deployInputSchema>;
export type DeployResult = z.infer<typeof deployResultSchema>;
export type RemoveInput = z.infer<typeof removeInputSchema>;
export type StartRunInput = z.infer<typeof startRunInputSchema>;
export type StartRunResult = z.infer<typeof startRunResultSchema>;
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;
export type GetRunInput = z.infer<typeof getRunInputSchema>;
export type GetRunResult = z.infer<typeof getRunResultSchema>;
export type ListRunsInput = z.infer<typeof listRunsInputSchema>;
export type ListRunsResult = z.infer<typeof listRunsResultSchema>;
export type ListChangedRunsInput = z.infer<typeof listChangedRunsInputSchema>;
export type ListChangedRunsResult = z.infer<typeof listChangedRunsResultSchema>;
export type GetRunOverviewInput = z.infer<typeof getRunOverviewInputSchema>;
export type GetRunOverviewResult = z.infer<typeof getRunOverviewResultSchema>;
export type RunEventsKey = z.infer<typeof runEventsKeySchema>;
export type RunEventsEvent = z.infer<typeof runEventsEventSchema>;
