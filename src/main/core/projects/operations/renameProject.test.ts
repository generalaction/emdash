import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PROJECT_NAME_LENGTH } from '@shared/projects';
import { renameProject } from './renameProject';

const mocks = vi.hoisted(() => ({
  updateMock: vi.fn(),
  setMock: vi.fn(),
  whereUpdateMock: vi.fn(),
  returningMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereSelectMock: vi.fn(),
  limitMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: mocks.updateMock,
    select: mocks.selectMock,
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
  mocks.selectMock.mockReturnValue({ from: mocks.fromMock });
  mocks.fromMock.mockReturnValue({ where: mocks.whereSelectMock });
  mocks.whereSelectMock.mockReturnValue({ limit: mocks.limitMock });
});

describe('renameProject', () => {
  it('trims and persists a valid project name', async () => {
    mocks.returningMock.mockResolvedValue([{ id: 'project-id' }]);
    mocks.limitMock
      .mockResolvedValueOnce([
        {
          id: 'project-id',
          workspaceProvider: 'local',
          name: 'Original Project',
          path: '/repo',
          baseRef: 'main',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'project-id',
          workspaceProvider: 'local',
          name: 'Renamed Project',
          path: '/repo',
          baseRef: 'main',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:01.000Z',
        },
      ]);

    const result = await renameProject('project-id', '  Renamed Project  ');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(mocks.setMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Project' })
    );
    expect(result.data.name).toBe('Renamed Project');
    expect(mocks.emitMock).toHaveBeenCalledWith('project:renamed', result.data);
  });

  it('returns the existing project without emitting when the name is unchanged', async () => {
    mocks.limitMock.mockResolvedValue([
      {
        id: 'project-id',
        workspaceProvider: 'local',
        name: 'Existing Project',
        path: '/repo',
        baseRef: 'main',
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    ]);

    const result = await renameProject('project-id', '  Existing Project  ');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.name).toBe('Existing Project');
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(mocks.emitMock).not.toHaveBeenCalled();
  });

  it('rejects empty and overlong names without touching the database', async () => {
    await expect(renameProject('project-id', '   ')).resolves.toEqual({
      success: false,
      error: { type: 'invalid-name' },
    });
    await expect(
      renameProject('project-id', 'x'.repeat(MAX_PROJECT_NAME_LENGTH + 1))
    ).resolves.toEqual({
      success: false,
      error: { type: 'invalid-name' },
    });
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('returns project-not-found when no row is updated', async () => {
    mocks.limitMock.mockResolvedValue([]);

    await expect(renameProject('missing-project', 'Renamed Project')).resolves.toEqual({
      success: false,
      error: { type: 'project-not-found' },
    });
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(mocks.emitMock).not.toHaveBeenCalled();
  });
});
