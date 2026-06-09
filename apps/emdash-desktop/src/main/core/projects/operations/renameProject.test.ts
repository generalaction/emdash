import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PROJECT_NAME_LENGTH } from '@shared/projects';
import { renameProject } from './renameProject';

const mocks = vi.hoisted(() => ({
  updateMock: vi.fn(),
  setMock: vi.fn(),
  whereUpdateMock: vi.fn(),
  returningMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: mocks.updateMock,
  },
}));

vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: {
    _emit: mocks.emitMock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMock.mockReturnValue({ set: mocks.setMock });
  mocks.setMock.mockReturnValue({ where: mocks.whereUpdateMock });
  mocks.whereUpdateMock.mockReturnValue({ returning: mocks.returningMock });
});

describe('renameProject', () => {
  it('trims and persists a valid project name', async () => {
    const updatedProject = {
      id: 'project-id',
      workspaceProvider: 'local',
      name: 'Renamed Project',
      path: '/repo',
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:01.000Z',
    };
    mocks.returningMock.mockResolvedValue([updatedProject]);

    await renameProject('project-id', '  Renamed Project  ');

    expect(mocks.setMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Project' })
    );
    expect(mocks.emitMock).toHaveBeenCalledWith(
      'project:renamed',
      expect.objectContaining({ id: 'project-id', name: 'Renamed Project', type: 'local' })
    );
  });

  it('updates and emits when the name is unchanged', async () => {
    mocks.returningMock.mockResolvedValue([
      {
        id: 'project-id',
        workspaceProvider: 'local',
        name: 'Existing Project',
        path: '/repo',
        baseRef: 'main',
        repositoryWorkspaceId: null,
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    ]);

    await renameProject('project-id', '  Existing Project  ');

    expect(mocks.updateMock).toHaveBeenCalled();
    expect(mocks.emitMock).toHaveBeenCalledWith(
      'project:renamed',
      expect.objectContaining({ name: 'Existing Project' })
    );
  });

  it('rejects empty and overlong names without touching the database', async () => {
    await expect(renameProject('project-id', '   ')).rejects.toThrow('Project name is invalid.');
    await expect(
      renameProject('project-id', 'x'.repeat(MAX_PROJECT_NAME_LENGTH + 1))
    ).rejects.toThrow('Project name is invalid.');
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('throws when no row is updated', async () => {
    mocks.returningMock.mockResolvedValue([]);

    await expect(renameProject('missing-project', 'Renamed Project')).rejects.toThrow(
      'Project not found.'
    );
    expect(mocks.updateMock).toHaveBeenCalled();
    expect(mocks.emitMock).not.toHaveBeenCalled();
  });
});
