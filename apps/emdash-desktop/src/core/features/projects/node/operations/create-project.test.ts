import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { createProject } from './create-project';
import { initializeRepository } from './initialize-repository';

const mocks = vi.hoisted(() => ({
  ensureRepositoryWorkspace: vi.fn(),
}));

vi.mock('./ensure-repository-workspace', () => ({
  ensureRepositoryWorkspace: mocks.ensureRepositoryWorkspace,
}));

describe('project creation without a git repository', () => {
  let rows: Record<string, unknown>[];
  let filesStat: ReturnType<typeof vi.fn>;
  let ensureRepository: ReturnType<typeof vi.fn>;
  let openProject: ReturnType<typeof vi.fn>;
  let dependencies: Parameters<typeof createProject>[0];

  beforeEach(() => {
    rows = [];
    filesStat = vi.fn().mockResolvedValue({
      success: true,
      data: { type: 'directory' },
    });
    ensureRepository = vi.fn();
    openProject = vi.fn().mockResolvedValue(undefined);
    mocks.ensureRepositoryWorkspace.mockReturnValue('repo-workspace-1');
    dependencies = {
      db: createFakeDb(rows),
      runtimes: {
        client: vi.fn().mockResolvedValue({
          success: true,
          data: {
            files: { fs: { stat: filesStat } },
            git: { ensureRepository },
          },
        }),
      },
      projects: { openProject },
    } as unknown as Parameters<typeof createProject>[0];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a project row for a non-git folder when init is not requested', async () => {
    ensureRepository.mockResolvedValue({
      success: false,
      error: { type: 'not-repository', path: hostPathFromNative('/workspace/plain-folder') },
    });

    const result = await createProject(dependencies, {
      type: 'local',
      id: 'project-plain',
      name: 'Plain Folder',
      path: '/workspace/plain-folder',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.path).toBe('/workspace/plain-folder');
    expect(result.data.baseRef).toBe('main');
    expect(result.data.repositoryWorkspaceId).toBeTruthy();
    expect(openProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-plain' }));

    const row = rows.find((entry) => entry.id === 'project-plain');
    expect(row?.baseRef).toBeNull();
  });

  it('initializes git for an existing project and persists the resolved base ref', async () => {
    rows.push({
      id: 'project-plain',
      name: 'Plain Folder',
      path: '/workspace/plain-folder',
      baseRef: null,
      workspaceProvider: 'local',
      sshConnectionId: null,
      repositoryWorkspaceId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    });
    ensureRepository.mockResolvedValue({
      success: true,
      data: { rootPath: hostPathFromNative('/workspace/plain-folder'), baseRef: 'main' },
    });

    const result = await initializeRepository(dependencies, 'project-plain');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(ensureRepository).toHaveBeenCalledWith({
      path: hostPathFromNative('/workspace/plain-folder'),
      options: { initIfMissing: true },
    });
    expect(result.data.baseRef).toBe('main');
    expect(result.data.repositoryWorkspaceId).toBeTruthy();

    const row = rows.find((entry) => entry.id === 'project-plain');
    expect(row?.baseRef).toBe('main');
  });
});

function createFakeDb(rows: Record<string, unknown>[]) {
  return {
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            workspaceProvider: 'local',
            sshConnectionId: null,
            repositoryWorkspaceId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            ...value,
            updatedAt: '2026-01-01T00:00:00.000Z',
          };
          rows.push(row);
          return [row];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [rows.find((row) => row.id === 'project-plain' && !row.deletedAt)],
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows.find((entry) => entry.id === 'project-plain' && !entry.deletedAt);
            if (!row) return [];
            Object.assign(row, value, { updatedAt: '2026-01-01T00:00:01.000Z' });
            return [row];
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof createProject>[0]['db'];
}
