import {
  bootstrapContextSchema,
  lenientBootstrapPlanSchema,
  workspaceRefSchema,
} from '@services/workspace-lifecycle/api';
import { z } from 'zod';

export const coordinatorStageStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'skipped',
  'failed',
]);

export const coordinatorErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  stageId: z.string().optional(),
  holders: z.array(z.string()).optional(),
  resolutions: z.array(z.string()).optional(),
});

export const coordinatorStageViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: coordinatorStageStatusSchema,
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      message: z.string().optional(),
    })
    .optional(),
  error: coordinatorErrorSchema.optional(),
});

export const coordinatorProgressSchema = z.object({
  stages: z.array(coordinatorStageViewSchema),
});

export const coordinatorResultSchema = z.object({
  path: z.string(),
});

export const sessionStartSpecSchema = z.object({
  runtime: z.string().min(1),
  sessionId: z.string().min(1),
  input: z.unknown(),
});

export const deactivateStrategySchema = z.enum(['stop', 'detach']);

export const activateInputSchema = z.object({
  ref: workspaceRefSchema,
  context: bootstrapContextSchema,
  setupPlan: lenientBootstrapPlanSchema,
  activationPlan: lenientBootstrapPlanSchema,
  sessions: z.array(sessionStartSpecSchema),
});

export const deactivateInputSchema = z.object({
  ref: workspaceRefSchema,
  context: bootstrapContextSchema,
  deactivationPlan: lenientBootstrapPlanSchema,
  strategy: deactivateStrategySchema,
});

export const teardownInputSchema = z.object({
  ref: workspaceRefSchema,
  context: bootstrapContextSchema,
  deactivationPlan: lenientBootstrapPlanSchema,
  teardownPlan: lenientBootstrapPlanSchema,
  force: z.boolean().optional(),
});

export type CoordinatorStageStatus = z.infer<typeof coordinatorStageStatusSchema>;
export type CoordinatorError = z.infer<typeof coordinatorErrorSchema>;
export type CoordinatorStageView = z.infer<typeof coordinatorStageViewSchema>;
export type CoordinatorProgress = z.infer<typeof coordinatorProgressSchema>;
export type CoordinatorResult = z.infer<typeof coordinatorResultSchema>;
export type SessionStartSpec = z.infer<typeof sessionStartSpecSchema>;
export type DeactivateStrategy = z.infer<typeof deactivateStrategySchema>;
export type ActivateInput = z.infer<typeof activateInputSchema>;
export type DeactivateInput = z.infer<typeof deactivateInputSchema>;
export type TeardownInput = z.infer<typeof teardownInputSchema>;
