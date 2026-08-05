import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveTask } from './archiveTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.selectLimit,
        }),
      }),
    }),
    update: () => ({
      set: mocks.updateSet,
    }),
  },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: {
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.capture,
  },
}));

describe('archiveTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.teardownTask.mockResolvedValue({ success: true });
  });

  it('archives by reaping the runtime without deleting workspace assets', async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: 'done',
      },
    ]);
    mocks.teardownTask.mockResolvedValue({ success: true });

    await archiveTask('project-1', 'task-1');

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        archivedAt: expect.anything(),
        updatedAt: expect.anything(),
      })
    );
    const updatePayload = mocks.updateSet.mock.calls[0]?.[0];
    expect(updatePayload).not.toHaveProperty('status');
    expect(updatePayload).not.toHaveProperty('statusChangedAt');

    expect(mocks.teardownTask).toHaveBeenCalledWith('task-1', 'archive');
    expect(mocks.capture).toHaveBeenCalledWith('task_archived', {
      project_id: 'project-1',
      task_id: 'task-1',
    });
    expect(mocks.selectLimit).toHaveBeenCalledTimes(1);
    expect(mocks.teardownTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateSet.mock.invocationCallOrder[0]!
    );
  });

  it('keeps the task unarchived when runtime teardown fails', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: 'task-1', workspaceId: 'workspace-1' }]);
    mocks.teardownTask.mockResolvedValue({
      success: false,
      error: { type: 'error', message: 'Failed to discover tmux sessions' },
    });

    await expect(archiveTask('project-1', 'task-1')).rejects.toThrow(
      'Failed to teardown task before archiving: Failed to discover tmux sessions'
    );

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
