import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';

const select = vi.fn();

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  isNotNull: vi.fn(() => 'isNotNull'),
  isNull: vi.fn(() => 'isNull'),
}));

vi.mock('@core/services/app-db/node/schema', () => ({
  projects: {
    id: 'projects.id',
    path: 'projects.path',
    workspaceProvider: 'projects.workspaceProvider',
    sshConnectionId: 'projects.sshConnectionId',
    repositoryWorkspaceId: 'projects.repositoryWorkspaceId',
    deletedAt: 'projects.deletedAt',
  },
  tasks: {
    id: 'tasks.id',
    name: 'tasks.name',
    status: 'tasks.status',
    archivedAt: 'tasks.archivedAt',
    updatedAt: 'tasks.updatedAt',
    lastInteractedAt: 'tasks.lastInteractedAt',
    workspaceId: 'tasks.workspaceId',
    projectId: 'tasks.projectId',
    deletedAt: 'tasks.deletedAt',
  },
  workspaces: {
    id: 'workspaces.id',
    type: 'workspaces.type',
    kind: 'workspaces.kind',
    location: 'workspaces.location',
    sshConnectionId: 'workspaces.sshConnectionId',
    path: 'workspaces.path',
    branchName: 'workspaces.branchName',
    config: 'workspaces.config',
    deletedAt: 'workspaces.deletedAt',
  },
}));

vi.mock('@core/services/runtime-broker/node/git', () => ({
  repositorySelector: (nativePath: string) => ({ repository: nativePath }),
  gitErrorMessage: (error: { message?: string }) => error.message ?? 'git failed',
}));

const dependencies = {
  db: { select } as never,
  taskSessions: { getTask: vi.fn(() => undefined) },
  runtimes: {
    client: vi.fn(async () => ({
      success: true,
      data: {
        files: {
          fs: {
            exists: vi.fn(async () => ({ success: true, data: true })),
          },
        },
        git: {
          repository: {
            listWorktrees: vi.fn(async () => ({
              success: false,
              error: { type: 'command-failed', message: 'not a git repository' },
            })),
          },
        },
      },
    })),
  } as never,
};

vi.mock('@core/features/workspaces/api/node/workspace-branch', () => ({
  getProvisionedWorkspaceBranch: vi.fn(() => undefined),
}));

describe('listProjectWorkspaces', () => {
  it('returns DB-derived root rows with a warning when git worktree listing fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-project-workspaces-'));
    try {
      select
        .mockReturnValueOnce(projectQuery([{ id: 'project-1', path: root }]))
        .mockReturnValueOnce(workspaceRows([]))
        .mockReturnValueOnce(taskRows([]));

      const { listProjectWorkspaces } = await import('./list-project-workspaces');
      const result = await listProjectWorkspaces(dependencies, 'project-1');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('not a git repository');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        kind: 'root',
        path: root,
        usage: null,
        pathState: 'measured',
      });
    } finally {
      select.mockReset();
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists and inspects worktrees through the remote runtime host', async () => {
    const remotePath = '/srv/projects/remote-repo';
    const client = vi.fn(async () => ({
      success: true,
      data: {
        files: {
          fs: {
            exists: vi.fn(async () => ({ success: true, data: true })),
          },
        },
        git: {
          repository: {
            listWorktrees: vi.fn(async () => ({
              success: true,
              data: [
                {
                  worktreePath: hostPathFromNative(remotePath),
                  isMain: true,
                  head: { kind: 'branch', name: 'main' },
                },
              ],
            })),
          },
        },
      },
    }));
    const remoteDependencies = {
      ...dependencies,
      runtimes: { client } as never,
    };
    select
      .mockReturnValueOnce(
        projectQuery([
          {
            id: 'project-remote',
            path: remotePath,
            workspaceProvider: 'ssh',
            sshConnectionId: 'ssh-1',
          },
        ])
      )
      .mockReturnValueOnce(workspaceRows([]))
      .mockReturnValueOnce(taskRows([]));

    const { listProjectWorkspaces } = await import('./list-project-workspaces');
    const result = await listProjectWorkspaces(remoteDependencies, 'project-remote');

    expect(client).toHaveBeenCalledWith({ type: 'remote', id: 'ssh-1' });
    expect(result.rows).toEqual([
      expect.objectContaining({
        kind: 'root',
        path: remotePath,
        pathState: 'measured',
        canCleanArtifacts: false,
        canDelete: false,
      }),
    ]);
  });
});

function projectQuery(
  rows: Array<{
    id: string;
    path: string;
    workspaceProvider?: string;
    sshConnectionId?: string | null;
  }>
) {
  return {
    from: () => ({
      where: () => ({
        limit: async () =>
          rows.map((row) => ({
            id: row.id,
            path: row.path,
            workspaceProvider: row.workspaceProvider ?? 'local',
            sshConnectionId: row.sshConnectionId ?? null,
            repositoryWorkspaceId: null,
          })),
      }),
    }),
  };
}

function workspaceRows(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

function taskRows(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}
