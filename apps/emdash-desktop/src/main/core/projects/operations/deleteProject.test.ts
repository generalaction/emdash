import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  enqueueDeleteProject: vi.fn(),
}));

vi.mock('@main/core/operations/operations-service', () => ({
  operationsService: mocks,
}));

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: true,
      data: { operationId: 'operation-1' },
    });
  });

  it('enqueues the project and its task cleanups', async () => {
    await deleteProject('project-1');

    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDeleteProject).toHaveBeenCalledWith('project-1');
  });

  it('keeps missing deletes idempotent', async () => {
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: false,
      error: { type: 'project-not-found', message: 'missing' },
    });

    await expect(deleteProject('missing')).resolves.toBeUndefined();
  });

  it('surfaces enqueue failures', async () => {
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: false,
      error: { type: 'database-error', message: 'database failed' },
    });

    await expect(deleteProject('project-1')).rejects.toThrow('database failed');
  });
});
