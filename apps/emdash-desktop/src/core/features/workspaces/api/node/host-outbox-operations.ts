import { serializedHostRefSchema } from '@emdash/core/primitives/host/api';
import {
  branchKernelResource as hostBranchKernelResource,
  repoKernelResource,
} from '@emdash/core/primitives/kernel-resources/api';
import { defineOperation } from '@emdash/core/primitives/kernel/api';
import { operationPredictionSchema } from '@emdash/core/primitives/operations/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';
import { workspaceKernelClaims } from '@core/primitives/operations/api/resources';
import { operationErrorSchema, operationResultSchema } from '@core/services/operations/node';

/**
 * Host outbox operations: desktop-plane kernel operations that carry a durable
 * host verb until the target host executes it. The desktop record is the outbox
 * entry — claims are held from admission until terminal, the dispatch gate
 * defers execution while the host is offline, and the handler submits the verb
 * to the host (idempotent by `hostOperationId`) and folds the host's stage
 * stream into this record.
 */

const HOST_OUTBOX_RETRY = {
  maxAttempts: 5,
  backoff: { kind: 'exponential', baseMs: 2_000, maxMs: 60_000 },
} as const;

const hostOutboxBaseFields = {
  version: z.literal('1'),
  source: z.enum(['user', 'reconciler']),
  /** Desktop-minted UUID; the idempotency key toward the host. */
  hostOperationId: z.string().min(1),
  /** Canonical serialized HostRef. */
  hostRef: serializedHostRefSchema,
  repoPath: z.string().min(1),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  entityName: z.string().optional(),
  hostLabel: z.string().optional(),
  prediction: operationPredictionSchema.optional(),
  confirmedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
};

const hostRemoveWorktreeInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      ...hostOutboxBaseFields,
      workspacePath: z.string().min(1),
      branchName: z.string().optional(),
      deleteBranch: z.boolean(),
      /** Workspace-runtime consumers to deactivate before removal (teardown scripts). */
      deactivateConsumers: z.union([z.literal('all'), z.array(z.string())]).optional(),
    })
  )
  .build();

const hostCreateWorktreeInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      ...hostOutboxBaseFields,
      workspacePath: z.string().min(1),
      branchName: z.string().min(1),
      startPoint: z.string().optional(),
      fetch: z.boolean().optional(),
    })
  )
  .build();

const hostRemoveRepositoryInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      ...hostOutboxBaseFields,
      workspacePath: z.string().min(1),
      deleteBranches: z.boolean().optional(),
    })
  )
  .build();

export type HostRemoveWorktreeInput = typeof hostRemoveWorktreeInputSchema.Type;
export type HostCreateWorktreeInput = typeof hostCreateWorktreeInputSchema.Type;
export type HostRemoveRepositoryInput = typeof hostRemoveRepositoryInputSchema.Type;

type WorktreeScopedInput = HostRemoveWorktreeInput | HostCreateWorktreeInput;

function worktreeClaims(input: WorktreeScopedInput) {
  return workspaceKernelClaims({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    branch:
      input.projectId && input.branchName
        ? { projectId: input.projectId, branchName: input.branchName }
        : undefined,
    worktree: {
      hostRef: input.hostRef,
      repoPath: input.repoPath,
      worktreePath: input.workspacePath,
    },
  });
}

export const hostRemoveWorktreeOperation = defineOperation({
  name: 'host-remove-worktree',
  input: hostRemoveWorktreeInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `outbox:remove-worktree:${input.hostRef}:${input.workspacePath}`,
  claims: (input) => [
    ...worktreeClaims(input),
    ...(input.deleteBranch && input.branchName
      ? hostBranchKernelResource.mutates({
          hostRef: input.hostRef,
          repoPath: input.repoPath,
          branchName: input.branchName,
        })
      : []),
  ],
  describe: (input) => input.entityName ?? input.workspacePath,
  retry: HOST_OUTBOX_RETRY,
});

export const hostCreateWorktreeOperation = defineOperation({
  name: 'host-create-worktree',
  input: hostCreateWorktreeInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `outbox:create-worktree:${input.hostRef}:${input.workspacePath}`,
  claims: (input) => worktreeClaims(input),
  describe: (input) => input.entityName ?? input.workspacePath,
  retry: HOST_OUTBOX_RETRY,
});

export const hostRemoveRepositoryOperation = defineOperation({
  name: 'host-remove-repository',
  input: hostRemoveRepositoryInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `outbox:remove-repository:${input.hostRef}:${input.repoPath}`,
  claims: (input) => [
    ...repoKernelResource.mutates({ hostRef: input.hostRef, repoPath: input.repoPath }),
    ...workspaceKernelClaims({ projectId: input.projectId, workspaceId: input.workspaceId }),
  ],
  describe: (input) => input.entityName ?? input.repoPath,
  retry: HOST_OUTBOX_RETRY,
});

export const hostOutboxOperationNames = [
  hostRemoveWorktreeOperation.name,
  hostCreateWorktreeOperation.name,
  hostRemoveRepositoryOperation.name,
] as const;
