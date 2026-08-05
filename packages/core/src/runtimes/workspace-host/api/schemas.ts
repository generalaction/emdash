import { operationStatuses } from '@primitives/kernel/api';
import {
  operationStageDisplaySchema,
  type OperationStageDisplay,
} from '@primitives/operations/api';
import { hostAbsolutePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const workspaceHostWorktreeHeadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string() }),
  z.object({ kind: z.literal('detached') }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);
export type WorkspaceHostWorktreeHead = z.infer<typeof workspaceHostWorktreeHeadSchema>;

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

export const workspaceHostNoticeScriptSchema = z.enum(['prepare', 'setup', 'run', 'teardown']);
export type WorkspaceHostNoticeScript = z.infer<typeof workspaceHostNoticeScriptSchema>;

export const workspaceHostNoticeSchema = z.object({
  path: hostAbsolutePathSchema,
  script: workspaceHostNoticeScriptSchema,
  status: z.enum(['failed', 'timed-out', 'cancelled']),
  message: z.string(),
  exitCode: z.number().int().optional(),
  outputTail: z.string(),
  at: z.number().int(),
});
export type WorkspaceHostNotice = z.infer<typeof workspaceHostNoticeSchema>;

export const workspaceHostNoticesListSchema = z.record(
  z.string(),
  z.array(workspaceHostNoticeSchema)
);
export type WorkspaceHostNoticesList = z.infer<typeof workspaceHostNoticesListSchema>;

export const workspaceHostInitializeRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type WorkspaceHostInitializeRequest = z.infer<typeof workspaceHostInitializeRequestSchema>;

export const workspaceHostRunScriptResultSchema = z.object({
  status: z.enum(['succeeded', 'skipped', 'failed', 'timed-out', 'cancelled']),
  message: z.string().optional(),
  exitCode: z.number().int().optional(),
  outputTail: z.string(),
});
export type WorkspaceHostRunScriptResult = z.infer<typeof workspaceHostRunScriptResultSchema>;

export const workspaceHostInitializeResultSchema = z.object({
  active: z.literal(true),
  prepare: workspaceHostRunScriptResultSchema,
  notices: z.array(workspaceHostNoticeSchema),
});
export type WorkspaceHostInitializeResult = z.infer<typeof workspaceHostInitializeResultSchema>;

export const workspaceHostRunScriptRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
  script: z.enum(['prepare', 'setup', 'run', 'teardown']),
});
export type WorkspaceHostRunScriptRequest = z.infer<typeof workspaceHostRunScriptRequestSchema>;

export const workspaceHostMeasureUsageRequestSchema = z.object({
  workspacePath: hostAbsolutePathSchema,
});
export type WorkspaceHostMeasureUsageRequest = z.infer<
  typeof workspaceHostMeasureUsageRequestSchema
>;

export const workspaceHostUsageErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type WorkspaceHostUsageError = z.infer<typeof workspaceHostUsageErrorSchema>;

export const workspaceHostUsageSchema = z.object({
  path: hostAbsolutePathSchema,
  /** Exclusive disk bytes for the workspace tree. */
  totalBytes: z.number().int().nonnegative(),
  /** Disk bytes attributable to git-ignored artifacts (reclaimable). */
  artifactBytes: z.number().int().nonnegative(),
  errors: z.array(workspaceHostUsageErrorSchema),
});
export type WorkspaceHostUsage = z.infer<typeof workspaceHostUsageSchema>;

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
  /** When set, push the branch to this remote with upstream tracking after creation. */
  pushRemote: z.string().min(1).optional(),
  preservePatterns: z.array(z.string()).default([]),
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
      ...operationStageDisplaySchema.shape,
      substages: z.array(workspaceHostOperationStageSchema).optional(),
    })
);
export interface WorkspaceHostOperationStage extends OperationStageDisplay {
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
