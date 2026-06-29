import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateTaskStatus } from './updateTaskStatus';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  capture: vi.fn(),
  selectLimit: vi.fn(),
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

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.capture,
  },
}));

describe('updateTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('persists the status timestamp and emits a renderer status update event', async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: 'task-1',
        projectId: 'project-1',
        status: 'todo',
      },
    ]);

    await updateTaskStatus('task-1', 'review');

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'review',
        updatedAt: expect.anything(),
        statusChangedAt: expect.anything(),
      })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'task:status-updated' }),
      {
        taskId: 'task-1',
        projectId: 'project-1',
        status: 'review',
      }
    );
    expect(mocks.capture).toHaveBeenCalledWith('task_status_changed', {
      from_status: 'todo',
      to_status: 'review',
      project_id: 'project-1',
      task_id: 'task-1',
    });
  });
});
