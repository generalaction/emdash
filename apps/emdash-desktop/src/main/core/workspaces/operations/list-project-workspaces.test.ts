import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installAppDbTestInstance } from '@tooling/vitest/app-db-test-instance';
import { describe, expect, it, vi } from 'vitest';

const select = vi.fn();

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  isNotNull: vi.fn(() => 'isNotNull'),
  isNull: vi.fn(() => 'isNull'),
}));

installAppDbTestInstance(() => ({ select }) as never);

vi.mock('@core/services/app-db/node/schema', () => ({
  projects: {
    id: 'projects.id',
    path: 'projects.path',
    workspaceProvider: 'projects.workspaceProvider',
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
    path: 'workspaces.path',
    branchName: 'workspaces.branchName',
    config: 'workspaces.config',
    deletedAt: 'workspaces.deletedAt',
  },
}));

vi.mock('@main/core/git/runtime-client', () => ({
  repositorySelector: (nativePath: string) => ({ repository: nativePath }),
  gitErrorMessage: (error: { message?: string }) => error.message ?? 'git failed',
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: { getTask: vi.fn(() => undefined) },
}));

vi.mock('@main/gateway/accessors', () => ({
  getGitRuntimeClient: vi.fn(async () => ({
    repository: {
      listWorktrees: vi.fn(async () => ({
        success: false,
        error: { type: 'command-failed', message: 'not a git repository' },
      })),
    },
  })),
}));

vi.mock('@main/core/workspaces/workspace-branch', () => ({
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
      const result = await listProjectWorkspaces('project-1');

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
});

function projectQuery(rows: Array<{ id: string; path: string }>) {
  return {
    from: () => ({
      where: () => ({
        limit: async () =>
          rows.map((row) => ({
            id: row.id,
            path: row.path,
            workspaceProvider: 'local',
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
