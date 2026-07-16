import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  enqueueDeleteTask: vi.fn(),
}));

vi.mock('@main/core/operations/operations-service', () => ({
  operationsService: mocks,
}));

describe('deleteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.enqueueDeleteTask.mockResolvedValue({
      success: true,
      data: { operationId: 'operation-1' },
    });
  });

  it('enqueues cleanup with the existing delete options', async () => {
    await deleteTask('project-1', 'task-1', {
      deleteWorktree: false,
      deleteBranch: true,
    });

    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDeleteTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      deleteWorktree: false,
      deleteBranch: true,
    });
  });

  it('keeps missing deletes idempotent', async () => {
    mocks.enqueueDeleteTask.mockResolvedValue({
      success: false,
      error: { type: 'task-not-found', message: 'missing' },
    });

    await expect(deleteTask('project-1', 'missing')).resolves.toBeUndefined();
  });

  it('surfaces enqueue failures', async () => {
    mocks.enqueueDeleteTask.mockResolvedValue({
      success: false,
      error: { type: 'database-error', message: 'database failed' },
    });

    await expect(deleteTask('project-1', 'task-1')).rejects.toThrow('database failed');
  });
});
