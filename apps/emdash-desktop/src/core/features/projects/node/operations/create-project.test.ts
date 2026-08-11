import { ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { createProject } from './create-project';
import { initializeRepository } from './initialize-repository';

const mocks = vi.hoisted(() => ({
  registerRepositoryWorkspace: vi.fn(),
}));

vi.mock('./register-repository-workspace', () => ({
  registerRepositoryWorkspace: mocks.registerRepositoryWorkspace,
}));

describe('project creation without a git repository', () => {
  let rows: Record<string, unknown>[];
  let filesStat: ReturnType<typeof vi.fn>;
  let ensureRepository: ReturnType<typeof vi.fn>;
  let closeProject: ReturnType<typeof vi.fn>;
  let openProject: ReturnType<typeof vi.fn>;
  let dependencies: Parameters<typeof initializeRepository>[0];

  beforeEach(() => {
    rows = [];
    filesStat = vi.fn().mockResolvedValue({
      success: true,
      data: { type: 'directory' },
    });
    ensureRepository = vi.fn();
    closeProject = vi.fn().mockResolvedValue(ok());
    openProject = vi.fn().mockResolvedValue(ok({}));
    mocks.registerRepositoryWorkspace.mockReturnValue('repo-workspace-1');
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
      projects: { closeProject, openProject },
    } as unknown as Parameters<typeof initializeRepository>[0];
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
    // Creation provenance stays honestly absent for a non-git folder — no
    // fabricated 'main' (spec: github-git-settings §3).
    expect(result.data.baseRef).toBeNull();
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
      repositoryWorkspaceId: 'repo-workspace-1',
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
    expect(closeProject).toHaveBeenCalledWith('project-plain');
    expect(openProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-plain' }));

    const row = rows.find((entry) => entry.id === 'project-plain');
    expect(row?.baseRef).toBe('main');
  });
});

function createFakeDb(rows: Record<string, unknown>[]) {
  const findRow = () => rows.find((row) => row.id === 'project-plain' && !row.deletedAt);
  return {
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
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
    // getProjectById joins the repository workspace row; the fake keeps the
    // path on the project row and projects it into the join columns.
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: async () => {
              const row = findRow();
              return row
                ? [
                    {
                      project: row,
                      repositoryPath: (row.path as string | undefined) ?? null,
                      repositoryLocation: 'local',
                      repositorySshConnectionId: null,
                    },
                  ]
                : [];
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: () => {
          const apply = () => {
            const row = findRow();
            if (!row) return undefined;
            Object.assign(row, value, { updatedAt: '2026-01-01T00:00:01.000Z' });
            return row;
          };
          return {
            then: (resolve: (value: unknown) => void) => resolve(apply()),
            run: () => {
              apply();
              return { changes: 1 };
            },
          };
        },
      }),
    }),
  } as unknown as Parameters<typeof createProject>[0]['db'];
}
