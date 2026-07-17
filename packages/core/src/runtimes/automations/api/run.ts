import { hostFileRefSchema } from '@primitives/path/api';
import { z } from 'zod';
import { automationIdSchema, automationRunConfigSnapshotSchema } from './deployment';

const nonBlankStringSchema = z.string().trim().min(1);
const nullableTimestampSchema = z.number().int().nonnegative().nullable();

export const automationRunIdSchema = z.string().min(1);

export const automationRunStatusSchema = z.enum([
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
  'done',
  'failed',
  'skipped',
  'cancelled',
]);

export const automationRunTriggerKindSchema = z.enum(['cron', 'manual']);

export const automationRunErrorStepSchema = z.enum([
  'queue',
  'provision_workspace',
  'start_session',
  'run',
]);

export const automationRunErrorSchema = z.object({
  step: automationRunErrorStepSchema,
  code: nonBlankStringSchema,
  message: z.string().optional(),
});

/**
 * Host-owned run record. `seq` is the host-global journal cursor.
 * `configSnapshot` is captured at insert time and is what the run executes
 * with. `generatedName` is the per-run human-friendly name used for the
 * branch and workspace. `conversationId` is minted by the automations runtime;
 * `sessionId` is the provider session id returned by session start.
 */
export const automationRunSchema = z.object({
  id: automationRunIdSchema,
  seq: z.number().int().positive(),
  automationId: automationIdSchema,
  status: automationRunStatusSchema,
  triggerKind: automationRunTriggerKindSchema,
  configSnapshot: automationRunConfigSnapshotSchema,
  generatedName: nonBlankStringSchema,
  scheduledAt: nullableTimestampSchema,
  deadlineAt: nullableTimestampSchema,
  startedAt: nullableTimestampSchema,
  finishedAt: nullableTimestampSchema,
  workspace: hostFileRefSchema.nullable(),
  branchName: nonBlankStringSchema.nullable(),
  conversationId: nonBlankStringSchema.nullable(),
  sessionId: nonBlankStringSchema.nullable(),
  error: automationRunErrorSchema.nullable(),
});

export type AutomationRunId = z.infer<typeof automationRunIdSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationRunTriggerKind = z.infer<typeof automationRunTriggerKindSchema>;
export type AutomationRunErrorStep = z.infer<typeof automationRunErrorStepSchema>;
export type AutomationRunError = z.infer<typeof automationRunErrorSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
