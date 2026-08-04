import {
  branchKernelResource,
  repoKernelResource,
  worktreeKernelResource,
} from '@primitives/kernel-resources/api';
import { defineOperation } from '@primitives/kernel/api';
import { defineOperationStagePlan } from '@primitives/operations/api';
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

export type CreateWorktreeStagePlanContext = {
  workspacePath: string;
  fetch: boolean;
  existing: boolean;
};
type CreateWorktreeStageExecutor = 'inspect' | 'fetch' | 'add-worktree' | 'verify';

export const createWorktreeStagePlan = defineOperationStagePlan<
  CreateWorktreeStagePlanContext,
  CreateWorktreeStageExecutor
>([
  {
    kind: 'stage',
    stage: { id: 'inspect', label: 'Inspect worktrees', executor: 'inspect' },
  },
  {
    kind: 'expansion',
    id: 'create-if-missing',
    expand: (context) =>
      context.existing
        ? []
        : [
            ...(context.fetch
              ? [{ id: 'fetch', label: 'Fetch repository refs', executor: 'fetch' as const }]
              : []),
            {
              id: 'add-worktree',
              label: 'Create git worktree',
              targetPath: context.workspacePath,
              executor: 'add-worktree' as const,
            },
            {
              id: 'verify',
              label: 'Verify worktree exists',
              targetPath: context.workspacePath,
              executor: 'verify' as const,
            },
          ],
  },
]);

export const createWorktreeOperation = Object.freeze({
  ...defineOperation({
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
  }),
  stagePlan: createWorktreeStagePlan,
});

export type RemoveWorktreeStagePlanContext = {
  workspacePath: string;
  deleteBranch: boolean;
  branchName?: string;
  teardownScript?: string;
};
type RemoveWorktreeStageExecutor =
  | 'kill-sessions'
  | 'teardown'
  | 'remove-worktree'
  | 'delete-branch';

export const removeWorktreeStagePlan = defineOperationStagePlan<
  RemoveWorktreeStagePlanContext,
  RemoveWorktreeStageExecutor
>([
  {
    kind: 'stage',
    stage: {
      id: 'kill-sessions',
      label: 'Kill sessions under worktree',
      executor: 'kill-sessions',
    },
  },
  {
    kind: 'expansion',
    id: 'teardown-script',
    expand: (context) =>
      context.teardownScript
        ? [
            {
              id: 'teardown',
              label: 'Run teardown script',
              targetPath: context.workspacePath,
              executor: 'teardown' as const,
            },
          ]
        : [],
  },
  {
    kind: 'expansion',
    id: 'worktree-target',
    expand: (context) => [
      {
        id: stageTargetId('remove-worktree', context.workspacePath),
        label: 'Remove git worktree',
        targetPath: context.workspacePath,
        executor: 'remove-worktree',
      },
      ...(context.deleteBranch && context.branchName
        ? [
            {
              id: stageTargetId('delete-branch', context.branchName),
              label: 'Delete git branch',
              executor: 'delete-branch' as const,
            },
          ]
        : []),
    ],
  },
]);

export const removeWorktreeOperation = Object.freeze({
  ...defineOperation({
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
  }),
  stagePlan: removeWorktreeStagePlan,
});

export type RemoveRepositoryStagePlanContext = {
  repoPath: string;
  worktreePaths: readonly string[];
  repositoryMissing: boolean;
};
type RemoveRepositoryStageExecutor =
  | 'kill-sessions'
  | 'inspect-worktrees'
  | 'remove-worktree'
  | 'prune-worktrees'
  | 'remove-repository';

export const removeRepositoryStagePlan = defineOperationStagePlan<
  RemoveRepositoryStagePlanContext,
  RemoveRepositoryStageExecutor
>([
  {
    kind: 'stage',
    stage: {
      id: 'kill-sessions',
      label: 'Kill sessions under repository',
      executor: 'kill-sessions',
    },
  },
  {
    kind: 'stage',
    stage: { id: 'inspect-worktrees', label: 'Inspect worktrees', executor: 'inspect-worktrees' },
  },
  {
    kind: 'expansion',
    id: 'repository-worktrees',
    expand: (context) =>
      (context.repositoryMissing ? [] : context.worktreePaths)
        .filter((path) => path !== context.repoPath)
        .map((path) => ({
          id: stageTargetId('remove-worktree', path),
          label: 'Remove git worktree',
          targetPath: path,
          executor: 'remove-worktree',
        })),
  },
  {
    kind: 'expansion',
    id: 'prune-if-present',
    expand: (context) =>
      context.repositoryMissing
        ? []
        : [{ id: 'prune-worktrees', label: 'Prune worktrees', executor: 'prune-worktrees' }],
  },
  {
    kind: 'expansion',
    id: 'repository-target',
    expand: (context) => [
      {
        id: stageTargetId('remove-repository', context.repoPath),
        label: 'Remove repository directory',
        targetPath: context.repoPath,
        executor: 'remove-repository',
      },
    ],
  },
]);

export const removeRepositoryOperation = Object.freeze({
  ...defineOperation({
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
  }),
  stagePlan: removeRepositoryStagePlan,
});

export const workspaceHostOperationDefinitions = [
  createWorktreeOperation,
  removeWorktreeOperation,
  removeRepositoryOperation,
] as const;

export const workspaceHostOperationErrorSchema = workspaceHostErrorSchema;
export const workspaceHostOperationVoidSchema = z.void();

function stageTargetId(prefix: string, target: string): string {
  return `${prefix}:${encodeURIComponent(target)}`;
}
