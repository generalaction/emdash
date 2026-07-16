import { hostFileRefSchema } from '@primitives/path/api';
import { z } from 'zod';
import { automationIdSchema, automationRunConfigSnapshotSchema } from './deployment';

export const automationRunIdSchema = z.string().min(1);

export const automationRunStatusSchema = z.enum([
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
  'running',
  'done',
  'failed',
  'skipped',
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
  code: z.string().min(1),
  message: z.string().optional(),
});

/**
 * Host-owned run record. `seq` is the host-global journal cursor.
 * `configSnapshot` is captured at insert time and is what the run executes
 * with. `generatedName` is the per-run human-friendly name used for the
 * branch, the worktree, and the adopted task. `conversationId` is minted by
 * the automations runtime; `sessionId` is the provider session id returned by
 * session start.
 */
export const automationRunSchema = z.object({
  id: automationRunIdSchema,
  seq: z.number().int().positive(),
  automationId: automationIdSchema,
  status: automationRunStatusSchema,
  triggerKind: automationRunTriggerKindSchema,
  configSnapshot: automationRunConfigSnapshotSchema,
  generatedName: z.string().min(1),
  scheduledAt: z.number().int().nullable(),
  deadlineAt: z.number().int().nullable(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  worktree: hostFileRefSchema.nullable(),
  branchName: z.string().nullable(),
  conversationId: z.string().nullable(),
  sessionId: z.string().nullable(),
  error: automationRunErrorSchema.nullable(),
});

export type AutomationRunId = z.infer<typeof automationRunIdSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationRunTriggerKind = z.infer<typeof automationRunTriggerKindSchema>;
export type AutomationRunErrorStep = z.infer<typeof automationRunErrorStepSchema>;
export type AutomationRunError = z.infer<typeof automationRunErrorSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
