import { lintConflictPolicyCompleteness } from '@emdash/core/primitives/kernel/testing';
import { describe, expect, test } from 'vitest';
import { deleteAutomationOperation } from '@core/features/automations/node/operations/delete-automation-definition';
import { deleteProjectOperation } from '@core/features/projects/node/operations/delete-project-definition';
import { deleteTaskOperation } from '@core/features/tasks/api/node/delete-task-operation';
import {
  hostCreateWorktreeOperation,
  hostRemoveRepositoryOperation,
  hostRemoveWorktreeOperation,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { createDesktopConflictPolicy } from './operation-definitions';

describe('desktop operation conflict policy', () => {
  test('has explicit policy entries for representative colliding inputs', () => {
    const samples = [
      {
        definition: deleteTaskOperation,
        input: {
          version: '1',
          source: 'user',
          taskId: 'task-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          hostRef: 'local',
          projectPath: '/repo',
          workspacePath: '/repo/.worktrees/task-1',
          branchName: 'task-1',
          deleteWorktree: true,
          deleteBranch: false,
          workspaceShared: false,
          createdAt: 1,
        },
      },
      {
        definition: hostRemoveWorktreeOperation,
        input: {
          version: '1',
          source: 'user',
          hostOperationId: 'host-op-1',
          hostRef: 'local',
          repoPath: '/repo',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          workspacePath: '/repo/.worktrees/task-1',
          branchName: 'task-1',
          deleteBranch: false,
          createdAt: 1,
        },
      },
      {
        definition: hostCreateWorktreeOperation,
        input: {
          version: '1',
          source: 'user',
          hostOperationId: 'host-op-2',
          hostRef: 'local',
          repoPath: '/repo',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          workspacePath: '/repo/.worktrees/task-1',
          branchName: 'task-1',
          createdAt: 1,
        },
      },
      {
        definition: hostRemoveRepositoryOperation,
        input: {
          version: '1',
          source: 'user',
          hostOperationId: 'host-op-3',
          hostRef: 'local',
          repoPath: '/repo',
          projectId: 'project-1',
          createdAt: 1,
        },
      },
      {
        definition: deleteProjectOperation,
        input: {
          version: '1',
          source: 'user',
          projectId: 'project-1',
          hostRef: 'local',
          createdAt: 1,
        },
      },
      {
        definition: deleteAutomationOperation,
        input: {
          version: '1',
          source: 'user',
          automationId: 'automation-1',
          projectId: 'project-1',
          hostRef: 'local',
          createdAt: 1,
        },
      },
    ];

    const policy = createDesktopConflictPolicy(samples.map((sample) => sample.definition));

    expect(lintConflictPolicyCompleteness(samples, policy)).toEqual([]);
  });
});
