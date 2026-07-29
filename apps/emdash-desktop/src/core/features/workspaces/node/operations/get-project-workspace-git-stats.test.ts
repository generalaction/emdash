import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import { getProjectWorkspaceGitStats } from './get-project-workspace-git-stats';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  list: vi.fn(),
}));

vi.mock('./list-project-workspaces', () => ({
  getProjectWorkspaceProject: mocks.getProject,
  listProjectWorkspaces: mocks.list,
  mapWithConcurrency: async <T, U>(
    items: readonly T[],
    _limit: number,
    mapItem: (item: T) => Promise<U>
  ) => Promise.all(items.map(mapItem)),
  projectWorkspaceHost: (project: { sshConnectionId: string | null }) => ({
    type: project.sshConnectionId ? 'remote' : 'local',
    id: project.sshConnectionId ?? 'local',
  }),
}));

vi.mock('@core/services/runtime-broker/node/git', () => ({
  checkoutSelector: (nativePath: string) => ({ checkout: nativePath }),
  repositorySelector: (nativePath: string) => ({ repository: nativePath }),
  gitErrorMessage: (error: { message?: string }) => error.message ?? 'git failed',
}));

describe('getProjectWorkspaceGitStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns changed line totals and branch divergence for a workspace', async () => {
    const row: ProjectWorkspaceRow = {
      kind: 'workspace',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      path: '/repo/worktree-1',
      branch: 'feature/a',
      tasks: [],
      usage: null,
      pathState: 'measured',
      canCleanArtifacts: false,
      canDelete: true,
      hasActiveSessions: false,
      errors: [],
    };
    mocks.getProject.mockResolvedValue({
      id: 'project-1',
      path: '/repo',
      workspaceProvider: 'local',
      sshConnectionId: null,
      repositoryWorkspaceId: 'workspace-root',
    });
    mocks.list.mockResolvedValue({
      scannedAt: new Date().toISOString(),
      projectId: 'project-1',
      rows: [row],
      totalBytes: 0,
      artifactBytes: 0,
      warnings: [],
    });

    const snapshot = vi.fn(async () => ({
      data: {
        branches: [
          {
            type: 'local',
            branch: 'feature/a',
            oid: 'abc123',
            divergence: { ahead: 2, behind: 1 },
          },
        ],
        tags: [],
      },
    }));
    const getChangedFiles = vi.fn(async () =>
      ok([
        { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 4 },
        { path: 'src/b.ts', status: 'added', additions: 5, deletions: 0 },
      ])
    );
    const client = vi.fn(async () =>
      ok({
        git: {
          repository: {
            model: {
              state: vi.fn(() => ({ snapshot })),
            },
          },
          checkout: { getChangedFiles },
        },
      } as never)
    );

    const result = await getProjectWorkspaceGitStats(
      {
        db: {} as never,
        runtimes: { client },
        taskSessions: { getTask: vi.fn() },
      },
      { projectId: 'project-1', paths: ['/repo/worktree-1'] }
    );

    expect(client).toHaveBeenCalledWith({ type: 'local', id: 'local' });
    expect(snapshot).toHaveBeenCalled();
    expect(getChangedFiles).toHaveBeenCalledWith({
      checkout: '/repo/worktree-1',
      target: { kind: 'working-vs-head' },
    });
    expect(result.results).toEqual([
      {
        path: '/repo/worktree-1',
        success: true,
        stats: { added: 15, removed: 4, ahead: 2, behind: 1 },
      },
    ]);
  });
});
