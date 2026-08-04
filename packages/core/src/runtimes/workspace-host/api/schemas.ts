import { operationStatuses } from '@primitives/kernel/api';
import { hostAbsolutePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const workspaceHostSnapshotTierSchema = z.enum(['presence', 'full']);
export type WorkspaceHostSnapshotTier = z.infer<typeof workspaceHostSnapshotTierSchema>;

export const workspaceHostSnapshotRequestSchema = z.object({
  repoRoot: hostAbsolutePathSchema,
  tier: workspaceHostSnapshotTierSchema,
});
export type WorkspaceHostSnapshotRequest = z.infer<typeof workspaceHostSnapshotRequestSchema>;

export const workspaceHostDiffStatsSchema = z.object({
  added: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});
export type WorkspaceHostDiffStats = z.infer<typeof workspaceHostDiffStatsSchema>;

export const workspaceHostWorktreeHeadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string() }),
  z.object({ kind: z.literal('detached') }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);
export type WorkspaceHostWorktreeHead = z.infer<typeof workspaceHostWorktreeHeadSchema>;

export const workspaceHostWorktreeObservationSchema = z.object({
  path: hostAbsolutePathSchema,
  adminName: z.string().optional(),
  isMain: z.boolean(),
  head: workspaceHostWorktreeHeadSchema,
  branch: z.string().nullable(),
  locked: z.boolean().optional(),
  prunable: z.boolean().optional(),
  prunableReason: z.string().optional(),
  status: z.enum(['present', 'corrupted']),
  corruptionReason: z.string().optional(),
  dirty: z.boolean().optional(),
  diffStats: workspaceHostDiffStatsSchema.optional(),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
});
export type WorkspaceHostWorktreeObservation = z.infer<
  typeof workspaceHostWorktreeObservationSchema
>;

export const workspaceHostRepositoryObservationSchema = z.object({
  path: hostAbsolutePathSchema,
  status: z.enum(['present', 'corrupted']),
  defaultBranch: z.string().optional(),
  corruptionReason: z.string().optional(),
});
export type WorkspaceHostRepositoryObservation = z.infer<
  typeof workspaceHostRepositoryObservationSchema
>;

export const workspaceHostRepoSnapshotSchema = z.object({
  repoRoot: hostAbsolutePathSchema,
  scannedAt: z.number().int(),
  tier: workspaceHostSnapshotTierSchema,
  repository: workspaceHostRepositoryObservationSchema,
  worktrees: z.array(workspaceHostWorktreeObservationSchema),
});
export type WorkspaceHostRepoSnapshot = z.infer<typeof workspaceHostRepoSnapshotSchema>;

export const workspaceHostErrorSchema = z.object({
  type: z.enum([
    'git-command-failed',
    'filesystem-error',
    'operation-rejected',
    'operation-not-found',
    'operation-admission-failed',
    'runtime-unavailable',
  ]),
  message: z.string(),
  code: z.string().optional(),
});
export type WorkspaceHostError = z.infer<typeof workspaceHostErrorSchema>;

export const workspaceHostOperationVerbSchema = z.enum([
  'host.createWorktree',
  'host.removeWorktree',
  'host.removeRepository',
]);
export type WorkspaceHostOperationVerb = z.infer<typeof workspaceHostOperationVerbSchema>;

export const workspaceHostOperationInputBaseSchema = z.object({
  version: z.literal('1'),
  operationId: z.string().min(1),
  hostId: z.string().min(1),
  repoPath: hostAbsolutePathSchema,
});

export const createWorktreeInputV1Schema = workspaceHostOperationInputBaseSchema.extend({
  worktreePath: hostAbsolutePathSchema,
  branchName: z.string().min(1),
  startPoint: z.string().min(1).optional(),
  fetch: z.boolean().optional(),
});
export type CreateWorktreeInput = z.infer<typeof createWorktreeInputV1Schema>;

export const removeWorktreeInputV1Schema = workspaceHostOperationInputBaseSchema.extend({
  worktreePath: hostAbsolutePathSchema,
  branchName: z.string().min(1).optional(),
  deleteBranch: z.boolean().optional(),
});
export type RemoveWorktreeInput = z.infer<typeof removeWorktreeInputV1Schema>;

export const removeRepositoryInputV1Schema = workspaceHostOperationInputBaseSchema.extend({
  deleteBranches: z.boolean().optional(),
});
export type RemoveRepositoryInput = z.infer<typeof removeRepositoryInputV1Schema>;

export const workspaceHostOperationInputSchema = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('host.createWorktree'), input: createWorktreeInputV1Schema }),
  z.object({ verb: z.literal('host.removeWorktree'), input: removeWorktreeInputV1Schema }),
  z.object({ verb: z.literal('host.removeRepository'), input: removeRepositoryInputV1Schema }),
]);
export type WorkspaceHostOperationInput = z.infer<typeof workspaceHostOperationInputSchema>;

export const workspaceHostOperationResultSchema = z.object({
  operationId: z.string(),
  changed: z.boolean(),
});
export type WorkspaceHostOperationResult = z.infer<typeof workspaceHostOperationResultSchema>;

export const workspaceHostSubmitOperationResultSchema = z.object({
  operationId: z.string(),
  kernelOperationId: z.string(),
});
export type WorkspaceHostSubmitOperationResult = z.infer<
  typeof workspaceHostSubmitOperationResultSchema
>;

export const workspaceHostOperationQuerySchema = z.object({
  operationId: z.string().min(1),
});
export type WorkspaceHostOperationQuery = z.infer<typeof workspaceHostOperationQuerySchema>;

export const workspaceHostOperationStatusSchema = z.enum(operationStatuses);

export const workspaceHostOperationStageSchema: z.ZodType<WorkspaceHostOperationStage> = z.lazy(
  () =>
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
      progress: z.number().optional(),
      error: z.object({ message: z.string() }).optional(),
      substages: z.array(workspaceHostOperationStageSchema).optional(),
    })
);
export interface WorkspaceHostOperationStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  progress?: number;
  error?: { message: string };
  substages?: WorkspaceHostOperationStage[];
}

export const workspaceHostOperationViewSchema = z.object({
  operationId: z.string(),
  kernelOperationId: z.string(),
  verb: workspaceHostOperationVerbSchema,
  status: workspaceHostOperationStatusSchema,
  stages: z.array(workspaceHostOperationStageSchema),
  updatedAt: z.number().int(),
  error: workspaceHostErrorSchema.optional(),
});
export type WorkspaceHostOperationView = z.infer<typeof workspaceHostOperationViewSchema>;

export const workspaceHostOperationsListSchema = z.record(
  z.string(),
  workspaceHostOperationViewSchema
);
export type WorkspaceHostOperationsList = z.infer<typeof workspaceHostOperationsListSchema>;
