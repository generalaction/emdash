import { z } from 'zod';
import { bootstrapStepSchema, type BootstrapStep } from '../steps/catalog';

export { bootstrapStepSchema };

export const bootstrapContextSchema = z.object({
  repoPath: z.string().min(1),
  worktreePoolPath: z.string().min(1),
  baseRemote: z.string().min(1),
  pushRemote: z.string().min(1),
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

export const bootstrapInputSchema = z.object({
  plan: lenientBootstrapPlanSchema,
  context: bootstrapContextSchema,
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
export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;
export type LenientBootstrapPlan = z.infer<typeof lenientBootstrapPlanSchema>;
export type ValidatePlanInput = z.infer<typeof validatePlanInputSchema>;
export type ValidatePlanResult = z.infer<typeof validatePlanResultSchema>;
export type PlanRejection = z.infer<typeof planRejectionSchema>;
export type BootstrapProgress = z.infer<typeof bootstrapProgressSchema>;
export type BootstrapStepReport = z.infer<typeof bootstrapStepReportSchema>;
export type BootstrapResult = z.infer<typeof bootstrapResultSchema>;
