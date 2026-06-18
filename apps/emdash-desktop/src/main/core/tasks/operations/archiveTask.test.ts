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
  });

  it('archives by detaching runtime without deleting workspace assets', async () => {
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

    expect(mocks.teardownTask).toHaveBeenCalledWith('task-1', 'detach');
    expect(mocks.capture).toHaveBeenCalledWith('task_archived', {
      project_id: 'project-1',
      task_id: 'task-1',
    });
    expect(mocks.selectLimit).toHaveBeenCalledTimes(1);
  });
});
