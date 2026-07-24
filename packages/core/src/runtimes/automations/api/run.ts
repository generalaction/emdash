import {
  workspaceProvisioningInputSchema,
  workspaceProvisioningResultSchema,
} from '@services/workspace-provisioning/api';
import { z } from 'zod';
import { automationIdSchema, automationRunConfigSnapshotSchema } from './deployment';

const nonBlankStringSchema = z.string().trim().min(1);
const nullableTimestampSchema = z.number().int().nonnegative().nullable();

export const automationRunIdSchema = z.string().min(1);

export const automationRunStatuses = [
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
  'done',
  'failed',
  'skipped',
  'cancelled',
] as const;

export const automationRunStatusSchema = z.enum(automationRunStatuses);

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

export const automationRunSchema = z.object({
  id: automationRunIdSchema,
  seq: z.number().int().positive(),
  automationId: automationIdSchema,
  status: automationRunStatusSchema,
  triggerKind: automationRunTriggerKindSchema,
  configSnapshot: automationRunConfigSnapshotSchema,
  generatedName: workspaceProvisioningInputSchema.shape.generatedName,
  scheduledAt: nullableTimestampSchema,
  deadlineAt: nullableTimestampSchema,
  startedAt: nullableTimestampSchema,
  finishedAt: nullableTimestampSchema,
  workspace: workspaceProvisioningResultSchema.shape.workspace.nullable(),
  branchName: workspaceProvisioningResultSchema.shape.branchName,
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
