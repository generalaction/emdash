import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  enqueueDeleteTask: vi.fn(),
}));
const operations = {} as never;

vi.mock('./delete-task-definition', () => ({
  enqueueDeleteTask: mocks.enqueueDeleteTask,
}));

describe('deleteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueDeleteTask.mockResolvedValue({
      success: true,
      data: { operationId: 'operation-1' },
    });
  });

  it('enqueues cleanup with the existing delete options', async () => {
    await deleteTask(operations, 'project-1', 'task-1', {
      deleteWorktree: false,
      deleteBranch: true,
    });

    expect(mocks.enqueueDeleteTask).toHaveBeenCalledWith(operations, {
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

    await expect(deleteTask(operations, 'project-1', 'missing')).resolves.toBeUndefined();
  });

  it('surfaces enqueue failures', async () => {
    mocks.enqueueDeleteTask.mockResolvedValue({
      success: false,
      error: { type: 'database-error', message: 'database failed' },
    });

    await expect(deleteTask(operations, 'project-1', 'task-1')).rejects.toThrow('database failed');
  });
});
