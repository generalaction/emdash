import { hostFileRefSchema } from '@primitives/path/api';
import {
  bootstrapContextSchema,
  lenientBootstrapPlanSchema,
  workspaceRefSchema,
} from '@runtimes/workspace/api/provisioning';
import { z } from 'zod';

export const workspaceKeySchema = hostFileRefSchema;

export const workspaceTopologySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('missing'),
  }),
  z.object({
    kind: z.literal('directory'),
  }),
  z.object({
    kind: z.literal('repository'),
    repositoryRoot: hostFileRefSchema,
    gitDir: hostFileRefSchema.optional(),
    branchName: z.string().optional(),
  }),
  z.object({
    kind: z.literal('worktree'),
    repositoryRoot: hostFileRefSchema,
    gitDir: hostFileRefSchema.optional(),
    commonDir: hostFileRefSchema.optional(),
    branchName: z.string().optional(),
  }),
]);

export const workspaceOperationKindSchema = z.enum([
  'reconcile',
  'provision',
  'convert',
  'activate',
  'deactivate',
  'teardown',
]);

export const workspaceOperationStageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['pending', 'running', 'done', 'skipped', 'failed']),
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export const workspaceOperationStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({
    kind: workspaceOperationKindSchema,
    operationId: z.string().min(1),
    stage: z.string().min(1).optional(),
    startedAt: z.number().int(),
  }),
]);

export const workspaceConsumerSchema = z.object({
  id: z.string().min(1),
  activatedAt: z.number().int(),
});

export const workspaceActivityStatusSchema = z.enum(['starting', 'running', 'exited']);

export const workspaceActivityResourceSchema = z.object({
  runtime: z.string().min(1),
  resourceId: z.string().min(1),
  status: workspaceActivityStatusSchema,
  startedAt: z.number().int().optional(),
});

export const workspaceErrorSchema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  stageId: z.string().optional(),
  holders: z.array(z.string()).optional(),
  resolutions: z.array(z.string()).optional(),
});

export const workspaceStateSchema = z.object({
  workspace: hostFileRefSchema,
  topology: workspaceTopologySchema,
  operation: workspaceOperationStateSchema,
  consumers: z.array(workspaceConsumerSchema),
  activity: z.object({
    resources: z.array(workspaceActivityResourceSchema),
  }),
  lastError: workspaceErrorSchema.optional(),
});

export const legacyWorkspaceAutomationSchema = z.object({
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
  shellSetup: z.string().optional(),
  autoRunSetup: z.boolean().default(true),
  autoRunRun: z.boolean().default(false),
});

export const workspaceLifecyclePlansSchema = z.object({
  ref: workspaceRefSchema,
  context: bootstrapContextSchema,
  setupPlan: lenientBootstrapPlanSchema.optional(),
  activationPlan: lenientBootstrapPlanSchema.optional(),
  deactivationPlan: lenientBootstrapPlanSchema.optional(),
  teardownPlan: lenientBootstrapPlanSchema.optional(),
});

export const workspaceOperationProgressSchema = z.object({
  operationId: z.string().min(1),
  kind: workspaceOperationKindSchema,
  stages: z.array(workspaceOperationStageSchema),
});

export const workspaceOperationResultSchema = z.object({
  workspace: hostFileRefSchema,
  path: z.string().optional(),
  topology: workspaceTopologySchema.optional(),
});

export const reconcileWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export const provisionWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export const convertWorkspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('repository'),
    operation: z.enum(['init', 'clone', 'adopt']),
    remoteUrl: z.string().optional(),
    initialBranch: z.string().optional(),
  }),
  z.object({
    kind: z.literal('worktree'),
    repository: hostFileRefSchema,
    branchName: z.string().min(1),
    createBranch: z.boolean().default(false),
    startPoint: z.string().optional(),
    target: hostFileRefSchema.optional(),
  }),
]);

export const convertWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  to: convertWorkspaceTargetSchema,
  sourcePolicy: z.enum(['keep', 'remove-if-empty']).default('keep'),
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export const activateWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  consumerId: z.string().min(1),
  automation: legacyWorkspaceAutomationSchema.optional(),
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export const deactivateWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  consumerId: z.string().min(1),
  strategy: z.enum(['stop', 'detach']),
  automation: legacyWorkspaceAutomationSchema.optional(),
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export const teardownWorkspaceInputSchema = z.object({
  workspace: hostFileRefSchema,
  force: z.boolean().default(false),
  automation: legacyWorkspaceAutomationSchema.optional(),
  lifecycle: workspaceLifecyclePlansSchema.optional(),
});

export type WorkspaceKey = z.infer<typeof workspaceKeySchema>;
export type WorkspaceTopology = z.infer<typeof workspaceTopologySchema>;
export type WorkspaceOperationKind = z.infer<typeof workspaceOperationKindSchema>;
export type WorkspaceOperationStage = z.infer<typeof workspaceOperationStageSchema>;
export type WorkspaceOperationState = z.infer<typeof workspaceOperationStateSchema>;
export type WorkspaceConsumer = z.infer<typeof workspaceConsumerSchema>;
export type WorkspaceActivityResource = z.infer<typeof workspaceActivityResourceSchema>;
export type WorkspaceError = z.infer<typeof workspaceErrorSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type LegacyWorkspaceAutomation = z.infer<typeof legacyWorkspaceAutomationSchema>;
export type WorkspaceLifecyclePlans = z.infer<typeof workspaceLifecyclePlansSchema>;
export type WorkspaceOperationProgress = z.infer<typeof workspaceOperationProgressSchema>;
export type WorkspaceOperationResult = z.infer<typeof workspaceOperationResultSchema>;
export type ReconcileWorkspaceInput = z.infer<typeof reconcileWorkspaceInputSchema>;
export type ProvisionWorkspaceInput = z.infer<typeof provisionWorkspaceInputSchema>;
export type ConvertWorkspaceInput = z.infer<typeof convertWorkspaceInputSchema>;
export type ActivateWorkspaceInput = z.infer<typeof activateWorkspaceInputSchema>;
export type DeactivateWorkspaceInput = z.infer<typeof deactivateWorkspaceInputSchema>;
export type TeardownWorkspaceInput = z.infer<typeof teardownWorkspaceInputSchema>;
