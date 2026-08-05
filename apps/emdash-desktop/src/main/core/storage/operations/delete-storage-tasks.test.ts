import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteStorageTasks } from './delete-storage-tasks';

const mocks = vi.hoisted(() => ({
  deleteTask: vi.fn(),
  getTaskStorageRows: vi.fn(),
  isLocalTaskWorkspace: vi.fn(() => true),
  isWorktreeRow: vi.fn(() => true),
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { deleteTask: mocks.deleteTask },
}));

vi.mock('../task-storage-rows', () => ({
  getTaskStorageRows: mocks.getTaskStorageRows,
  isLocalTaskWorkspace: mocks.isLocalTaskWorkspace,
  isWorktreeRow: mocks.isWorktreeRow,
}));

describe('deleteStorageTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a failed cleanup when task deletion refuses to skip teardown', async () => {
    mocks.getTaskStorageRows.mockResolvedValue([
      {
        taskId: 'task-1',
        taskName: 'Task 1',
        projectId: 'project-1',
        projectName: 'Project 1',
        projectPath: '/tmp/project',
        projectType: 'local',
        status: 'done',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        lastInteractedAt: null,
        archivedAt: '2026-01-01',
        workspaceId: 'workspace-1',
        workspaceType: 'local',
        workspaceKind: 'worktree',
        workspaceLocation: 'local',
        workspacePath: '/tmp/worktree',
        workspaceBranchName: 'task/one',
        workspaceConfig: null,
      },
    ]);
    mocks.deleteTask.mockRejectedValue(
      new Error('Cannot safely teardown task task-1: project project-1 is not mounted.')
    );

    await expect(deleteStorageTasks(['task-1'])).resolves.toEqual({
      deletedCount: 0,
      failedCount: 1,
      results: [
        {
          taskId: 'task-1',
          projectId: 'project-1',
          taskName: 'Task 1',
          success: false,
          reason: 'delete-failed',
          message: 'Cannot safely teardown task task-1: project project-1 is not mounted.',
        },
      ],
    });
  });
});
