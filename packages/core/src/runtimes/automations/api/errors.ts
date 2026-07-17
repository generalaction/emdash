import { z } from 'zod';
import { automationIdSchema } from './deployment';
import { automationRunIdSchema } from './run';

const automationNotFoundErrorSchema = z.object({
  type: z.literal('automation-not-found'),
  automationId: automationIdSchema,
  message: z.string(),
});

const runNotFoundErrorSchema = z.object({
  type: z.literal('run-not-found'),
  runId: automationRunIdSchema,
  message: z.string(),
});

const automationDisabledErrorSchema = z.object({
  type: z.literal('automation-disabled'),
  automationId: automationIdSchema,
  message: z.string(),
});

const runtimeUnavailableErrorSchema = z.object({
  type: z.literal('runtime-unavailable'),
  message: z.string(),
});

export const deployErrorSchema = runtimeUnavailableErrorSchema;

export const removeErrorSchema = z.discriminatedUnion('type', [
  automationNotFoundErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const startRunErrorSchema = z.discriminatedUnion('type', [
  automationNotFoundErrorSchema,
  automationDisabledErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const cancelRunErrorSchema = z.discriminatedUnion('type', [
  runNotFoundErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const getRunsErrorSchema = runtimeUnavailableErrorSchema;

export type DeployError = z.infer<typeof deployErrorSchema>;
export type RemoveError = z.infer<typeof removeErrorSchema>;
export type StartRunError = z.infer<typeof startRunErrorSchema>;
export type CancelRunError = z.infer<typeof cancelRunErrorSchema>;
export type GetRunsError = z.infer<typeof getRunsErrorSchema>;
