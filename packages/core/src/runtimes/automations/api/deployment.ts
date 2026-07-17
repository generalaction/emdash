import {
  acpSessionStartInputSchema,
  tuiSessionStartInputSchema,
} from '@services/session-start/api';
import { workspaceProvisioningConfigSchema } from '@services/workspace-provisioning/api';
import { z } from 'zod';

const nonBlankStringSchema = z.string().trim().min(1);

export const automationIdSchema = z.string().min(1);

export const automationScheduleSchema = z.object({
  expr: z.string().trim().min(1),
  tz: z.string().trim().min(1),
});

export const automationAcpAgentConfigSchema = z.object({
  type: z.literal('acp'),
  start: acpSessionStartInputSchema.shape.input.omit({
    conversationId: true,
    cwd: true,
    sessionId: true,
  }),
  title: nonBlankStringSchema.optional(),
});

export const automationTuiAgentConfigSchema = z.object({
  type: z.literal('tui'),
  start: tuiSessionStartInputSchema.shape.input.omit({
    conversationId: true,
    cwd: true,
    sessionId: true,
    cols: true,
    rows: true,
  }),
  title: nonBlankStringSchema.optional(),
});

export const automationAgentConfigSchema = z.discriminatedUnion('type', [
  automationAcpAgentConfigSchema,
  automationTuiAgentConfigSchema,
]);

export const automationDeploymentSchema = z.object({
  automationId: automationIdSchema,
  enabled: z.boolean(),
  name: nonBlankStringSchema,
  schedule: automationScheduleSchema,
  agent: automationAgentConfigSchema,
  workspace: workspaceProvisioningConfigSchema,
  updatedAt: z.number().int().nonnegative(),
});

export const automationRunConfigSnapshotSchema = automationDeploymentSchema.pick({
  name: true,
  schedule: true,
  agent: true,
  workspace: true,
});

export type AutomationId = z.infer<typeof automationIdSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationAcpAgentConfig = z.infer<typeof automationAcpAgentConfigSchema>;
export type AutomationTuiAgentConfig = z.infer<typeof automationTuiAgentConfigSchema>;
export type AutomationAgentConfig = z.infer<typeof automationAgentConfigSchema>;
export type AutomationDeployment = z.infer<typeof automationDeploymentSchema>;
export type AutomationRunConfigSnapshot = z.infer<typeof automationRunConfigSnapshotSchema>;
