import z from 'zod';

export const operationConfirmationReasonSchema = z.enum([
  'stale',
  'workspace-modified',
  'reconciler-proposed',
  'workspace-busy',
]);

export const operationEntityKindSchema = z.enum(['task', 'automation', 'workspace', 'project']);

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
    status: z.literal('cleaning'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('waiting'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('waiting-children'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('blocked-host-offline'),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('awaiting-confirmation'),
    confirmationReason: operationConfirmationReasonSchema,
    error: z.string().optional(),
  }),
  operationDisplayBaseSchema.extend({
    status: z.literal('failed'),
    error: z.string(),
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
export type OperationDisplayState = z.infer<typeof operationDisplayStateSchema>;
export type OperationMutationError = z.infer<typeof operationMutationErrorSchema>;
