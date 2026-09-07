import { z } from 'zod';

export const invalidAutomationDefinitionReasonSchema = z.enum([
  'name_required',
  'automation_not_configured',
  'conversation_config_prompt_required',
  'cron_invalid',
]);

const projectNotFoundErrorSchema = z.object({
  type: z.literal('project-not-found'),
  projectId: z.string(),
  message: z.string(),
});

const automationNotFoundErrorSchema = z.object({
  type: z.literal('automation-not-found'),
  automationId: z.string(),
  message: z.string(),
});

const runtimeUnavailableErrorSchema = z.object({
  type: z.literal('runtime-unavailable'),
  message: z.string(),
});

export const automationDefinitionErrorSchema = z.discriminatedUnion('type', [
  projectNotFoundErrorSchema,
  automationNotFoundErrorSchema,
  z.object({
    type: z.literal('automation-conflict'),
    automationId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('invalid-definition'),
    reason: invalidAutomationDefinitionReasonSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal('workspace-not-found'),
    workspaceId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('workspace-not-supported'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('deployment-stale'),
    automationId: z.string(),
    expectedRevision: z.number().int().positive(),
    actualRevision: z.number().int().positive(),
    message: z.string(),
  }),
  runtimeUnavailableErrorSchema,
]);

export const automationAdoptionErrorSchema = z.discriminatedUnion('type', [
  automationNotFoundErrorSchema,
  z.object({
    type: z.literal('no-project-attached'),
    automationId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('run-not-found'),
    runId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('run-not-adoptable'),
    runId: z.string(),
    message: z.string(),
  }),
  projectNotFoundErrorSchema,
  z.object({
    type: z.literal('adoption-unavailable'),
    message: z.string(),
  }),
  runtimeUnavailableErrorSchema,
]);

export type InvalidAutomationDefinitionReason = z.infer<
  typeof invalidAutomationDefinitionReasonSchema
>;
export type AutomationDefinitionError = z.infer<typeof automationDefinitionErrorSchema>;
export type AutomationAdoptionError = z.infer<typeof automationAdoptionErrorSchema>;
