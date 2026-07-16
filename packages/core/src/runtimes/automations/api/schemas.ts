import { z } from 'zod';
import { automationDeploymentSchema, automationIdSchema } from './deployment';
import { automationRunIdSchema, automationRunSchema } from './run';

export const GET_RUNS_DEFAULT_LIMIT = 200;
export const GET_RUNS_MAX_LIMIT = 1_000;

export const deployInputSchema = automationDeploymentSchema;

/** Echoes the deployment as stored so the client commits exactly what the host has. */
export const deployResultSchema = z.object({
  deployment: automationDeploymentSchema,
  deployedAt: z.number().int(),
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

export const stopRunInputSchema = z.object({
  runId: automationRunIdSchema,
});

/**
 * Journal catch-up. Returns runs with `seq > sinceSeq` for the given
 * automation ids, ordered by seq ascending. Client keeps one cursor per host.
 */
export const getRunsInputSchema = z.object({
  sinceSeq: z.number().int().nonnegative(),
  automationIds: z.array(automationIdSchema).min(1),
  limit: z.number().int().positive().max(GET_RUNS_MAX_LIMIT).optional(),
});

export const getRunsResultSchema = z.object({
  runs: z.array(automationRunSchema).max(GET_RUNS_MAX_LIMIT),
  /** High-water mark after this page (`max(seq)` among returned, or `sinceSeq` if empty). */
  nextSeq: z.number().int().nonnegative(),
});

/** Selects which automation runs a client receives from `runEvents`. */
export const runEventsKeySchema = z.object({
  automationIds: z.array(automationIdSchema).min(1),
});

/** Live run upserts. On reconnect, client re-pulls via `getRuns`. */
export const runEventsEventSchema = z.object({
  run: automationRunSchema,
});

export type DeployInput = z.infer<typeof deployInputSchema>;
export type DeployResult = z.infer<typeof deployResultSchema>;
export type RemoveInput = z.infer<typeof removeInputSchema>;
export type StartRunInput = z.infer<typeof startRunInputSchema>;
export type StartRunResult = z.infer<typeof startRunResultSchema>;
export type StopRunInput = z.infer<typeof stopRunInputSchema>;
export type GetRunsInput = z.infer<typeof getRunsInputSchema>;
export type GetRunsResult = z.infer<typeof getRunsResultSchema>;
export type RunEventsKey = z.infer<typeof runEventsKeySchema>;
export type RunEventsEvent = z.infer<typeof runEventsEventSchema>;
