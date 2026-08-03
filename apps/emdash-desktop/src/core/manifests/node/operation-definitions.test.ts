import { lintConflictPolicyCompleteness } from '@emdash/core/primitives/kernel/testing';
import { describe, expect, test } from 'vitest';
import { deleteAutomationOperation } from '@core/features/automations/node/operations/delete-automation-definition';
import { deleteProjectOperation } from '@core/features/projects/node/operations/delete-project-definition';
import { deleteTaskOperation } from '@core/features/tasks/api/node/delete-task-operation';
import { cleanupSessionsOperation } from '@core/features/workspaces/node/operations/cleanup-sessions-definition';
import {
  archiveWorkspaceOperation,
  deleteWorkspaceOperation,
} from '@core/features/workspaces/node/operations/workspace-lifecycle-definitions';
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
        definition: deleteWorkspaceOperation,
        input: {
          version: '1',
          source: 'user',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          entityKey: 'workspace-1',
          hostRef: 'local',
          projectPath: '/repo',
          workspacePath: '/repo/.worktrees/task-1',
          branchName: 'task-1',
          deleteWorktree: true,
          deleteBranch: false,
          createdAt: 1,
        },
      },
      {
        definition: archiveWorkspaceOperation,
        input: {
          version: '1',
          source: 'user',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          entityKey: 'workspace-1',
          hostRef: 'local',
          projectPath: '/repo',
          workspacePath: '/repo/.worktrees/task-1',
          branchName: 'task-1',
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
        definition: cleanupSessionsOperation,
        input: {
          version: '1',
          source: 'reconciler',
          entityId: 'session-1',
          projectId: 'project-1',
          hostRef: 'local',
          acpConversationIds: ['conversation-1'],
          tuiConversationIds: [],
          terminalSessionIds: [],
          tmuxSessionNames: [],
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
