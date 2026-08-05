import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveTask } from './archiveTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  selectLimit: vi.fn(),
  teardownTaskResources: vi.fn(),
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

vi.mock('./teardownTaskResources', () => ({
  teardownTaskResources: mocks.teardownTaskResources,
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
    mocks.teardownTaskResources.mockResolvedValue({ success: true });
  });

  it('archives by reaping the runtime without deleting workspace assets', async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: 'task-1',
        name: 'Task 1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        status: 'done',
      },
    ]);
    await archiveTask('project-1', 'task-1');

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        archivedAt: expect.anything(),
        lifecycleTeardownAt: expect.anything(),
        updatedAt: expect.anything(),
      })
    );
    const updatePayload = mocks.updateSet.mock.calls[0]?.[0];
    expect(updatePayload).not.toHaveProperty('status');
    expect(updatePayload).not.toHaveProperty('statusChangedAt');
    expect(updatePayload).not.toHaveProperty('providerDestroyAt');

    expect(mocks.teardownTaskResources).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', workspaceId: 'workspace-1' }),
      'archive'
    );
    expect(mocks.teardownTaskResources.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateSet.mock.invocationCallOrder[0]
    );
    expect(mocks.capture).toHaveBeenCalledWith('task_archived', {
      project_id: 'project-1',
      task_id: 'task-1',
    });
    expect(mocks.selectLimit).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'returns an error',
      () =>
        mocks.teardownTaskResources.mockResolvedValue({
          success: false,
          error: { type: 'error', message: 'project is not mounted' },
        }),
    ],
    ['rejects', () => mocks.teardownTaskResources.mockRejectedValue(new Error('teardown crashed'))],
  ])('keeps the task active when teardown %s', async (_label, arrangeFailure) => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: 'task-1',
        name: 'Task 1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      },
    ]);
    arrangeFailure();

    await expect(archiveTask('project-1', 'task-1')).rejects.toThrow();

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
