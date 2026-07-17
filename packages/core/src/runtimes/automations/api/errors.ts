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

const invalidScheduleErrorSchema = z.object({
  type: z.literal('invalid-schedule'),
  automationId: automationIdSchema,
  message: z.string(),
});

const repositoryUnavailableErrorSchema = z.object({
  type: z.literal('repository-unavailable'),
  automationId: automationIdSchema,
  message: z.string(),
});

const ioErrorSchema = z.object({
  type: z.literal('io'),
  message: z.string(),
});

export const automationDeploymentErrorSchema = z.discriminatedUnion('type', [
  invalidScheduleErrorSchema,
  repositoryUnavailableErrorSchema,
  ioErrorSchema,
]);

export const automationRemoveErrorSchema = z.discriminatedUnion('type', [
  automationNotFoundErrorSchema,
  ioErrorSchema,
]);

export const startRunErrorSchema = z.discriminatedUnion('type', [
  automationNotFoundErrorSchema,
  automationDisabledErrorSchema,
  invalidScheduleErrorSchema,
  repositoryUnavailableErrorSchema,
  ioErrorSchema,
]);

export const stopRunErrorSchema = z.discriminatedUnion('type', [
  runNotFoundErrorSchema,
  ioErrorSchema,
]);

export const getRunsErrorSchema = ioErrorSchema;

export type AutomationDeploymentError = z.infer<typeof automationDeploymentErrorSchema>;
export type AutomationRemoveError = z.infer<typeof automationRemoveErrorSchema>;
export type StartRunError = z.infer<typeof startRunErrorSchema>;
export type StopRunError = z.infer<typeof stopRunErrorSchema>;
export type GetRunsError = z.infer<typeof getRunsErrorSchema>;
