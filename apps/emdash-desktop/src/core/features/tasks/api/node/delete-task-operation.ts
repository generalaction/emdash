import { defineOperation } from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';
import { deleteTaskKernelClaims } from '@core/primitives/operations/api/resources';
import {
  operationErrorSchema,
  operationResultSchema,
  operationRetryPolicy,
} from '@core/services/operations/node';

const deleteTaskInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      taskId: z.string(),
      projectId: z.string(),
      workspaceId: z.string().nullable().optional(),
      hostRef: z.string(),
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      projectPath: z.string().optional(),
      workspacePath: z.string().optional(),
      branchName: z.string().optional(),
      deleteWorktree: z.boolean(),
      deleteBranch: z.boolean(),
      workspaceShared: z.boolean(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type DeleteTaskOperationInput = typeof deleteTaskInputSchema.Type;

export const deleteTaskOperation = defineOperation({
  name: 'delete-task',
  input: deleteTaskInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `task:${input.taskId}`,
  claims: (input) =>
    deleteTaskKernelClaims({
      projectId: input.projectId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      branch: input.branchName
        ? { projectId: input.projectId, branchName: input.branchName }
        : undefined,
      worktree:
        input.projectPath && input.workspacePath
          ? {
              hostRef: input.hostRef,
              repoPath: input.projectPath,
              worktreePath: input.workspacePath,
            }
          : undefined,
      workspaceShared: input.workspaceShared,
    }),
  describe: (input) => input.entityName ?? input.taskId,
  retry: operationRetryPolicy,
});
