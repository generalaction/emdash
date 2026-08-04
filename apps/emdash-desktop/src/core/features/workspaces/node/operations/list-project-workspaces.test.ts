import { parseAbsolute } from '@emdash/core/primitives/path/api';
import { workspaceHostRepoSnapshotSchema } from '@emdash/core/runtimes/workspace-host/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  repository: {
    id: 'project-1-repository-workspace',
    type: 'local' as const,
    kind: 'repository' as const,
    location: 'local' as const,
    sshConnectionId: null,
    parentId: null,
    path: '/repo',
    key: null,
    data: null,
    config: null,
    branchName: null,
    linesAdded: null,
    linesDeleted: null,
    observedStatus: null,
    observedGitBranch: null,
    observedData: null,
    lastObservedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    untrackedAt: null,
  },
}));
const select = vi.fn();
const applyRepoSnapshot = vi.fn();

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  inArray: vi.fn(() => 'inArray'),
  isNotNull: vi.fn(() => 'isNotNull'),
  isNull: vi.fn(() => 'isNull'),
  or: vi.fn(() => 'or'),
}));

vi.mock('@core/features/workspaces/api/node/registry', () => ({
  createWorkspaceRegistry: () => ({ getLive: () => state.repository }),
  isAnnotatedWorkspace: (row: { config: unknown; hasTaskLink?: boolean }) =>
    row.config !== null || row.hasTaskLink === true,
  liveWorkspaces: () => 'liveWorkspaces',
  workspaceRegistryTable: {
    id: 'workspaces.id',
    type: 'workspaces.type',
    kind: 'workspaces.kind',
    location: 'workspaces.location',
    sshConnectionId: 'workspaces.sshConnectionId',
    parentId: 'workspaces.parentId',
    path: 'workspaces.path',
    branchName: 'workspaces.branchName',
    config: 'workspaces.config',
    observedStatus: 'workspaces.observedStatus',
    observedGitBranch: 'workspaces.observedGitBranch',
    observedData: 'workspaces.observedData',
    lastObservedAt: 'workspaces.lastObservedAt',
  },
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
}));

vi.mock('../sync/apply-repo-snapshot', () => ({ applyRepoSnapshot }));
vi.mock('@core/features/workspaces/api/node/workspace-branch', () => ({
  getProvisionedWorkspaceBranch: vi.fn(() => undefined),
}));

const db = { select } as never;
const taskSessions = { getTask: vi.fn(() => undefined) };

describe('listProjectWorkspaces', () => {
  beforeEach(() => {
    select.mockReset();
    applyRepoSnapshot.mockReset();
    Object.assign(state.repository, {
      id: 'project-1-repository-workspace',
      location: 'local',
      sshConnectionId: null,
      path: '/repo',
    });
  });

  it('returns registry root rows without mutating observations when scanning fails', async () => {
    select
      .mockReturnValueOnce(projectQuery([{ id: 'project-1', path: '/repo' }]))
      .mockReturnValueOnce(taskRows([]))
      .mockReturnValueOnce(
        workspaceRows([registryRow({ id: state.repository.id, path: '/repo' })])
      );

    const result = await list({
      client: vi.fn(async () => ({
        success: true,
        data: {
          workspaceHost: {
            snapshotRepository: vi.fn(async () => ({
              success: false,
              error: { type: 'git-command-failed', message: 'not a git repository' },
            })),
          },
        },
      })),
    });

    expect(result.warnings[0]).toContain('not a git repository');
    expect(applyRepoSnapshot).not.toHaveBeenCalled();
    expect(result.rows[0]).toMatchObject({ kind: 'root', path: '/repo', pathState: 'measured' });
  });

  it('scans through the remote workspace host, applies, then reads rows', async () => {
    const remotePath = '/srv/projects/remote-repo';
    Object.assign(state.repository, {
      id: 'project-remote-repository-workspace',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: remotePath,
    });
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
      .mockReturnValueOnce(taskRows([]))
      .mockReturnValueOnce(
        workspaceRows([
          registryRow({ id: state.repository.id, path: remotePath, location: 'remote' }),
        ])
      );
    const client = vi.fn(async () => ({
      success: true,
      data: {
        workspaceHost: {
          snapshotRepository: vi.fn(async () => ({
            success: true,
            data: snapshot(remotePath, []),
          })),
        },
      },
    }));

    const result = await list({ client }, 'project-remote');

    expect(client).toHaveBeenCalledWith({ type: 'remote', id: 'ssh-1' });
    expect(applyRepoSnapshot).toHaveBeenCalledOnce();
    expect(result.rows[0]).toMatchObject({
      kind: 'root',
      path: remotePath,
      canCleanArtifacts: false,
      canDelete: false,
    });
  });

  it('projects a missing annotated registry row without probing stat', async () => {
    select
      .mockReturnValueOnce(projectQuery([{ id: 'project-1', path: '/repo' }]))
      .mockReturnValueOnce(
        taskRows([
          {
            taskId: 'task-1',
            name: 'Missing task',
            status: 'in_progress',
            archivedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastInteractedAt: null,
            workspaceId: 'workspace-1',
          },
        ])
      )
      .mockReturnValueOnce(
        workspaceRows([
          registryRow({ id: state.repository.id, path: '/repo' }),
          registryRow({
            id: 'workspace-1',
            path: '/repo/missing',
            observedStatus: 'missing',
          }),
        ])
      );

    const result = await list({ client: successfulClient('/repo') });

    expect(result.rows.find((row) => row.workspaceId === 'workspace-1')).toMatchObject({
      kind: 'workspace',
      pathState: 'missing',
      pathIssue: { kind: 'path-gone' },
    });
  });

  it('projects host corruption details from the converged registry', async () => {
    const reason = 'gitdir file points to non-existent location';
    select
      .mockReturnValueOnce(projectQuery([{ id: 'project-1', path: '/repo' }]))
      .mockReturnValueOnce(taskRows([]))
      .mockReturnValueOnce(
        workspaceRows([
          registryRow({ id: state.repository.id, path: '/repo' }),
          registryRow({
            id: 'stale',
            path: '/repo/stale',
            observedStatus: 'corrupted',
            observedData: { corruptionReason: reason },
          }),
        ])
      );

    const result = await list({ client: successfulClient('/repo') });

    expect(result.rows.find((row) => row.workspaceId === 'stale')).toMatchObject({
      kind: 'candidate',
      pathState: 'missing',
      pathIssue: { kind: 'prunable', reason },
    });
  });
});

async function list(runtimes: { client: ReturnType<typeof vi.fn> }, projectId = 'project-1') {
  const { listProjectWorkspaces } = await import('./list-project-workspaces');
  return listProjectWorkspaces({ db, taskSessions, runtimes } as never, projectId);
}

function successfulClient(repoPath: string) {
  return vi.fn(async () => ({
    success: true,
    data: {
      workspaceHost: {
        snapshotRepository: vi.fn(async () => ({
          success: true,
          data: snapshot(repoPath, []),
        })),
      },
    },
  }));
}

function snapshot(repoPath: string, worktrees: string[]) {
  const parsed = parseAbsolute(repoPath);
  if (!parsed.success) throw new Error('Expected absolute test path');
  return workspaceHostRepoSnapshotSchema.parse({
    repoRoot: parsed.data,
    scannedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    tier: 'presence',
    repository: { path: parsed.data, status: 'present' },
    worktrees: worktrees.map((value) => {
      const path = parseAbsolute(value);
      if (!path.success) throw new Error('Expected absolute worktree path');
      return {
        path: path.data,
        isMain: false,
        head: { kind: 'detached' },
        branch: null,
        status: 'present',
      };
    }),
  });
}

function registryRow(overrides: Record<string, unknown>) {
  return {
    id: 'workspace',
    type: 'local',
    kind: 'worktree',
    location: 'local',
    sshConnectionId: null,
    path: '/repo/worktree',
    branchName: null,
    config: null,
    observedStatus: 'present',
    observedGitBranch: null,
    observedData: null,
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function projectQuery(
  rows: Array<{
    id: string;
    path: string;
    workspaceProvider?: string;
    sshConnectionId?: string | null;
    repositoryWorkspaceId?: string | null;
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
            repositoryWorkspaceId: row.repositoryWorkspaceId ?? `${row.id}-repository-workspace`,
          })),
      }),
    }),
  };
}

function workspaceRows(rows: unknown[]) {
  return { from: () => ({ where: async () => rows }) };
}

function taskRows(rows: unknown[]) {
  return { from: () => ({ where: async () => rows }) };
}
