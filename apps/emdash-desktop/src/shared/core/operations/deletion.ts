import z from 'zod';
import { operationKinds } from './operation-types';

export const deletionEntityKindSchema = z.enum(['task', 'workspace', 'project']);

const deletionBaseSchema = z.object({
  operationId: z.string(),
  operationKind: z.enum(operationKinds),
  entityId: z.string(),
  entityKind: deletionEntityKindSchema,
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
});

export const deletionStateSchema = z.discriminatedUnion('status', [
  deletionBaseSchema.extend({
    status: z.literal('cleaning'),
  }),
  deletionBaseSchema.extend({
    status: z.literal('blocked-host-offline'),
  }),
  deletionBaseSchema.extend({
    status: z.literal('awaiting-confirmation'),
    confirmationReason: z.enum(['stale', 'workspace-modified', 'reconciler-proposed']),
  }),
  deletionBaseSchema.extend({
    status: z.literal('failed'),
    error: z.string(),
  }),
]);

export const deletionListSchema = z.record(z.string(), deletionStateSchema);

export const deletionModelKeySchema = z.object({
  entityId: z.string().optional(),
});

export const deletionMutationErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export const deletionMutationResultSchema = z.object({
  operationId: z.string().optional(),
});

export type DeletionEntityKind = z.infer<typeof deletionEntityKindSchema>;
export type DeletionState = z.infer<typeof deletionStateSchema>;
export type DeletionList = z.infer<typeof deletionListSchema>;
export type DeletionMutationError = z.infer<typeof deletionMutationErrorSchema>;
