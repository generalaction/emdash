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

export const invalidScheduleErrorSchema = z.object({
  type: z.literal('invalid-schedule'),
  reason: z.enum([
    'malformed_expression',
    'no_future_occurrence',
    'invalid_expression_or_timezone',
  ]),
  message: z.string(),
});

export const deployErrorSchema = z.discriminatedUnion('type', [
  invalidScheduleErrorSchema,
  runtimeUnavailableErrorSchema,
]);

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

export const runReadErrorSchema = runtimeUnavailableErrorSchema;

export type InvalidScheduleError = z.infer<typeof invalidScheduleErrorSchema>;
export type DeployError = z.infer<typeof deployErrorSchema>;
export type RemoveError = z.infer<typeof removeErrorSchema>;
export type StartRunError = z.infer<typeof startRunErrorSchema>;
export type CancelRunError = z.infer<typeof cancelRunErrorSchema>;
export type RunReadError = z.infer<typeof runReadErrorSchema>;
