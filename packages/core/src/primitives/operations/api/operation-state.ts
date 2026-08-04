import z from 'zod';

export const operationConfirmationReasonSchema = z.enum([
  'stale',
  'workspace-modified',
  'reconciler-proposed',
  'workspace-busy',
]);

export const operationEntityKindSchema = z.enum(['task', 'automation', 'workspace', 'project']);

export const operationStageDisplaySchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  progress: z.number().min(0).max(1).optional(),
  error: z.object({ message: z.string() }).optional(),
});

export const operationPredictedStageSchema = z.object({
  id: z.string(),
  label: z.string(),
  targetPath: z.string().optional(),
  /** 'registry' = a tracked registry row says so; 'assumed' = e.g. "sessions, if any". */
  basis: z.enum(['registry', 'assumed']),
});

/**
 * A desktop-compiled, non-authoritative preview of what a queued host operation
 * will probably do. Discarded wholesale once the host accepts and streams its
 * own expansion.
 */
export const operationPredictionSchema = z.object({
  compiledAt: z.number().int().nonnegative(),
  /** lastObservedAt of the stalest registry row consulted; drives the staleness caption. */
  observedAsOf: z.number().int().nonnegative().nullable(),
  stages: z.array(operationPredictedStageSchema),
});

const operationDisplayBaseSchema = z.object({
  operationId: z.string(),
  operationKind: z.string(),
  entityId: z.string(),
  entityKind: operationEntityKindSchema,
  projectId: z.string().optional(),
  entityName: z.string().optional(),
  hostRef: z.string(),
  hostLabel: z.string().optional(),
  workspacePath: z.string().optional(),
  branchName: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  currentStep: z.string().optional(),
  completedSteps: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export const operationDisplayStateSchema = z.discriminatedUnion('status', [
  operationDisplayBaseSchema.extend({
    status: z.literal('queued'),
    prediction: operationPredictionSchema.optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('running'),
    stages: z.array(operationStageDisplaySchema).optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('waiting'),
    prediction: operationPredictionSchema.optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('waiting-children'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('succeeded'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('blocked-host-offline'),
    prediction: operationPredictionSchema.optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('awaiting-confirmation'),
    confirmationReason: operationConfirmationReasonSchema,
    error: z.string().optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('failed'),
    error: z.string(),
    stages: z.array(operationStageDisplaySchema).optional(),
  }),
]);

export const operationMutationErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export const operationMutationResultSchema = z.object({
  operationId: z.string().optional(),
});

export type OperationConfirmationReason = z.infer<typeof operationConfirmationReasonSchema>;
export type OperationEntityKind = z.infer<typeof operationEntityKindSchema>;
export type OperationStageDisplay = z.infer<typeof operationStageDisplaySchema>;
export type OperationPredictedStage = z.infer<typeof operationPredictedStageSchema>;
export type OperationPrediction = z.infer<typeof operationPredictionSchema>;
export type OperationDisplayState = z.infer<typeof operationDisplayStateSchema>;
export type OperationMutationError = z.infer<typeof operationMutationErrorSchema>;
