import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  enqueueDeleteProject: vi.fn(),
}));
const operations = {} as never;

vi.mock('./delete-project-definition', () => ({
  enqueueDeleteProject: mocks.enqueueDeleteProject,
}));

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: true,
      data: { operationId: 'operation-1' },
    });
  });

  it('enqueues the project and its task cleanups', async () => {
    await deleteProject(operations, 'project-1');

    expect(mocks.enqueueDeleteProject).toHaveBeenCalledWith(operations, 'project-1');
  });

  it('keeps missing deletes idempotent', async () => {
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: false,
      error: { type: 'project-not-found', message: 'missing' },
    });

    await expect(deleteProject(operations, 'missing')).resolves.toBeUndefined();
  });

  it('surfaces enqueue failures', async () => {
    mocks.enqueueDeleteProject.mockResolvedValue({
      success: false,
      error: { type: 'database-error', message: 'database failed' },
    });

    await expect(deleteProject(operations, 'project-1')).rejects.toThrow('database failed');
  });
});
