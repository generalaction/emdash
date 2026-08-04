import {
  branchKernelResource,
  repoKernelResource,
  worktreeKernelResource,
} from '@primitives/kernel-resources/api';
import { defineOperation } from '@primitives/kernel/api';
import { formatAbsolute } from '@primitives/path/api';
import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { z } from 'zod';
import {
  createWorktreeInputV1Schema,
  removeRepositoryInputV1Schema,
  removeWorktreeInputV1Schema,
  workspaceHostErrorSchema,
  workspaceHostOperationResultSchema,
  type CreateWorktreeInput,
  type RemoveRepositoryInput,
  type RemoveWorktreeInput,
} from './schemas';

export const createWorktreeInputSchema = defineVersionedSchema()
  .initial('1', createWorktreeInputV1Schema)
  .build();

export const removeWorktreeInputSchema = defineVersionedSchema()
  .initial('1', removeWorktreeInputV1Schema)
  .build();

export const removeRepositoryInputSchema = defineVersionedSchema()
  .initial('1', removeRepositoryInputV1Schema)
  .build();

export const createWorktreeOperation = defineOperation({
  name: 'host.createWorktree',
  input: createWorktreeInputSchema,
  result: workspaceHostOperationResultSchema,
  error: workspaceHostErrorSchema,
  key: (input: CreateWorktreeInput) => input.operationId,
  claims: (input: CreateWorktreeInput) => [
    ...worktreeKernelResource.mutates({
      hostRef: input.hostId,
      repoPath: formatAbsolute(input.repoPath),
      worktreePath: formatAbsolute(input.worktreePath),
    }),
    ...branchKernelResource.mutates({
      hostRef: input.hostId,
      repoPath: formatAbsolute(input.repoPath),
      branchName: input.branchName,
    }),
  ],
  describe: (input: CreateWorktreeInput) => `Create worktree ${input.worktreePath}`,
  retry: { maxAttempts: 3, backoff: { kind: 'exponential', baseMs: 500, maxMs: 10_000 } },
});

export const removeWorktreeOperation = defineOperation({
  name: 'host.removeWorktree',
  input: removeWorktreeInputSchema,
  result: workspaceHostOperationResultSchema,
  error: workspaceHostErrorSchema,
  key: (input: RemoveWorktreeInput) => input.operationId,
  claims: (input: RemoveWorktreeInput) => [
    ...worktreeKernelResource.mutates({
      hostRef: input.hostId,
      repoPath: formatAbsolute(input.repoPath),
      worktreePath: formatAbsolute(input.worktreePath),
    }),
    ...(input.deleteBranch && input.branchName
      ? branchKernelResource.mutates({
          hostRef: input.hostId,
          repoPath: formatAbsolute(input.repoPath),
          branchName: input.branchName,
        })
      : []),
  ],
  describe: (input: RemoveWorktreeInput) => `Remove worktree ${input.worktreePath}`,
  retry: { maxAttempts: 3, backoff: { kind: 'exponential', baseMs: 500, maxMs: 10_000 } },
});

export const removeRepositoryOperation = defineOperation({
  name: 'host.removeRepository',
  input: removeRepositoryInputSchema,
  result: workspaceHostOperationResultSchema,
  error: workspaceHostErrorSchema,
  key: (input: RemoveRepositoryInput) => input.operationId,
  claims: (input: RemoveRepositoryInput) => [
    ...repoKernelResource.mutates({
      hostRef: input.hostId,
      repoPath: formatAbsolute(input.repoPath),
    }),
  ],
  describe: (input: RemoveRepositoryInput) => `Remove repository ${input.repoPath}`,
  retry: { maxAttempts: 3, backoff: { kind: 'exponential', baseMs: 500, maxMs: 10_000 } },
});

export const workspaceHostOperationDefinitions = [
  createWorktreeOperation,
  removeWorktreeOperation,
  removeRepositoryOperation,
] as const;

export const workspaceHostOperationErrorSchema = workspaceHostErrorSchema;
export const workspaceHostOperationVoidSchema = z.void();
