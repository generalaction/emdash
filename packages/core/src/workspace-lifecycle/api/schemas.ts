import { z } from 'zod';
import { bootstrapStepSchema, type BootstrapStep } from '../steps/catalog';

export { bootstrapStepSchema };

export const bootstrapContextSchema = z.object({
  repoPath: z.string().min(1),
  preservePatterns: z.array(z.string()).default([]),
});

export const bootstrapStepStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'skipped',
  'failed',
]);

export const bootstrapStepWarningSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export const bootstrapErrorSchema = z.object({
  stepId: z.string().optional(),
  stepKind: z.string().optional(),
  type: z.string(),
  message: z.string(),
  resolutions: z.array(z.string()).optional(),
});

export const bootstrapStepViewSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  status: bootstrapStepStatusSchema,
  attempt: z.number().int().positive().optional(),
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      message: z.string().optional(),
    })
    .optional(),
  warnings: z.array(bootstrapStepWarningSchema).optional(),
  error: bootstrapErrorSchema.optional(),
});

export const bootstrapPlanSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      step: bootstrapStepSchema,
    })
  ),
});

export const lenientBootstrapStepSchema = z.object({
  kind: z.string(),
  args: z.unknown(),
});

export const lenientBootstrapPlanSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      step: lenientBootstrapStepSchema,
    })
  ),
});

export const validatePlanInputSchema = z.object({
  plan: lenientBootstrapPlanSchema,
});

export const validatePlanResultSchema = z.object({
  stepCount: z.number().int().nonnegative(),
});

export const planRejectionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('unsupported-step'),
    kind: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('invalid-args'),
    stepId: z.string(),
    stepKind: z.string(),
    message: z.string(),
  }),
]);

export const bootstrapProgressSchema = z.object({
  steps: z.array(bootstrapStepViewSchema),
});

export const bootstrapStepReportSchema = z.object({
  stepId: z.string(),
  kind: z.string(),
  args: z.unknown(),
  facts: z.object({
    created: z.boolean().optional(),
    path: z.string().optional(),
  }),
});

export const bootstrapResultSchema = z.object({
  path: z.string(),
  warnings: z.array(bootstrapStepWarningSchema),
  report: z.array(bootstrapStepReportSchema),
});

export const workspaceLifecyclePhaseSchema = z.enum([
  'unprovisioned',
  'provisioning',
  'provisioned',
  'setting-up',
  'ready',
  'tearing-down',
]);

export const setupStateSchema = z.enum(['ready', 'setup-needed', 'setup-stale', 'not-applicable']);

export const phaseKindSchema = z.enum(['provision', 'setup', 'teardown']);

export const gitStateSchema = z.enum(['none', 'repo', 'worktree']);

export const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('worktree'),
    repoPath: z.string().min(1),
    path: z.string().min(1),
    branchName: z.string().min(1),
    setupConfigHash: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('directory'),
    path: z.string().min(1),
    setupConfigHash: z.string().min(1).optional(),
  }),
]);

export const workspaceLifecycleKeySchema = z.object({
  path: z.string().min(1),
});

export const lifecycleStateSchema = z.object({
  phase: workspaceLifecyclePhaseSchema,
  setup: setupStateSchema,
  git: gitStateSchema,
  branchName: z.string().optional(),
  branchCreatedByEmdash: z.boolean().optional(),
  path: z.string(),
  lastError: bootstrapErrorSchema.optional(),
  activeJobId: z.string().optional(),
});

export const runPhaseInputSchema = z.object({
  ref: workspaceRefSchema,
  phase: phaseKindSchema,
  plan: lenientBootstrapPlanSchema,
  context: bootstrapContextSchema,
  force: z.boolean().optional(),
});

export const stepOutputKeySchema = z.object({
  jobId: z.string().min(1),
  stepId: z.string().min(1),
});

export const observedWorkspaceStateSchema = z.object({
  git: gitStateSchema,
  path: z.string(),
  directoryExists: z.boolean(),
  branchName: z.string().optional(),
  branchExists: z.boolean().optional(),
  branchCreatedByEmdash: z.boolean(),
  worktree: z
    .object({
      registered: z.boolean(),
      directoryExists: z.boolean(),
    })
    .optional(),
  setup: setupStateSchema,
});

export const listWorkspacesInputSchema = z.object({
  repoPath: z.string().min(1),
});

export const workspaceListEntrySchema = z.object({
  path: z.string(),
  branchName: z.string().optional(),
  isMain: z.boolean(),
  directoryExists: z.boolean(),
  branchCreatedByEmdash: z.boolean(),
  hasSetupStamp: z.boolean(),
  stampConfigHash: z.string().optional(),
});

export type BootstrapContext = z.infer<typeof bootstrapContextSchema>;
export type { BootstrapStep };
export type BootstrapStepStatus = z.infer<typeof bootstrapStepStatusSchema>;
export type BootstrapStepWarning = z.infer<typeof bootstrapStepWarningSchema>;
export type BootstrapError = z.infer<typeof bootstrapErrorSchema>;
export type BootstrapStepView = z.infer<typeof bootstrapStepViewSchema>;
export type PlannedBootstrapStep = {
  id: string;
  label: string;
  step: BootstrapStep;
};
export type BootstrapPlan = {
  steps: PlannedBootstrapStep[];
};
export type LenientBootstrapPlan = z.infer<typeof lenientBootstrapPlanSchema>;
export type ValidatePlanInput = z.infer<typeof validatePlanInputSchema>;
export type ValidatePlanResult = z.infer<typeof validatePlanResultSchema>;
export type PlanRejection = z.infer<typeof planRejectionSchema>;
export type BootstrapProgress = z.infer<typeof bootstrapProgressSchema>;
export type BootstrapStepReport = z.infer<typeof bootstrapStepReportSchema>;
export type BootstrapResult = z.infer<typeof bootstrapResultSchema>;
export type WorkspaceLifecyclePhase = z.infer<typeof workspaceLifecyclePhaseSchema>;
export type PhaseKind = z.infer<typeof phaseKindSchema>;
export type SetupState = z.infer<typeof setupStateSchema>;
export type GitState = z.infer<typeof gitStateSchema>;
export type WorkspaceRef = z.infer<typeof workspaceRefSchema>;
export type WorkspaceLifecycleKey = z.infer<typeof workspaceLifecycleKeySchema>;
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;
export type RunPhaseInput = z.infer<typeof runPhaseInputSchema>;
export type StepOutputKey = z.infer<typeof stepOutputKeySchema>;
export type ObservedWorkspaceState = z.infer<typeof observedWorkspaceStateSchema>;
export type ListWorkspacesInput = z.infer<typeof listWorkspacesInputSchema>;
export type WorkspaceListEntry = z.infer<typeof workspaceListEntrySchema>;
