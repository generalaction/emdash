import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import { getProjectWorkspaces } from './getProjectWorkspaces';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  registryGet: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: mocks.registryGet,
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROJ_ID = 'proj-1';
const REPO_WS_ID = 'ws-repo';
const WORKTREE_WS_ID = 'ws-worktree';

const worktreeConfig: WorkspaceConfig = {
  version: '2',
  git: {
    kind: 'create-branch',
    branchName: 'feat/x',
    fromBranch: { type: 'local', branch: 'main' },
  },
  workspace: { kind: 'new-worktree' },
};

// ─── DB mock helpers ─────────────────────────────────────────────────────────

/**
 * Sets up dbSelect to respond to calls in order.
 * Call 1: projects row (repositoryWorkspaceId)
 * Call 2: task+workspace join rows
 * Call 3: repo workspace row
 */
function setupDb({
  repositoryWorkspaceId = REPO_WS_ID,
  taskWsRows = [],
  repoWsRow = null as null | object,
}: {
  repositoryWorkspaceId?: string | null;
  taskWsRows?: object[];
  repoWsRow?: null | object;
}) {
  mocks.dbSelect
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(repositoryWorkspaceId ? [{ repositoryWorkspaceId }] : []),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(taskWsRows),
        }),
      }),
    });

  if (repositoryWorkspaceId) {
    mocks.dbSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(repoWsRow ? [repoWsRow] : []),
        }),
      }),
    });
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getProjectWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registryGet.mockReturnValue(undefined); // not live by default
  });

  it('returns empty array when project has no repository workspace and no tasks', async () => {
    setupDb({ repositoryWorkspaceId: null, taskWsRows: [] });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result).toEqual([]);
  });

  it('includes the project-root workspace when repositoryWorkspaceId exists', async () => {
    setupDb({
      repositoryWorkspaceId: REPO_WS_ID,
      taskWsRows: [],
      repoWsRow: {
        id: REPO_WS_ID,
        kind: 'project-root',
        type: 'local',
        path: '/repo',
        branchName: null,
        config: null,
        linesAdded: null,
        linesDeleted: null,
      },
    });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: REPO_WS_ID,
      kind: 'project-root',
      path: '/repo',
      taskId: null,
      taskName: null,
      isLive: false,
    });
  });

  it('includes worktree workspaces from tasks', async () => {
    setupDb({
      repositoryWorkspaceId: null,
      taskWsRows: [
        {
          wsId: WORKTREE_WS_ID,
          wsKind: 'worktree',
          wsType: 'local',
          wsPath: '/worktrees/feat-x',
          wsBranchName: 'feat/x',
          wsConfig: worktreeConfig,
          wsLinesAdded: 10,
          wsLinesDeleted: 3,
          taskId: 'task-1',
          taskName: 'My Feature',
        },
      ],
    });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: WORKTREE_WS_ID,
      kind: 'worktree',
      path: '/worktrees/feat-x',
      branchName: 'feat/x',
      linesAdded: 10,
      linesDeleted: 3,
      taskId: 'task-1',
      taskName: 'My Feature',
      isLive: false,
    });
  });

  it('deduplicates when two tasks share the same workspace', async () => {
    setupDb({
      repositoryWorkspaceId: null,
      taskWsRows: [
        {
          wsId: WORKTREE_WS_ID,
          wsKind: 'worktree',
          wsType: 'local',
          wsPath: '/worktrees/feat-x',
          wsBranchName: 'feat/x',
          wsConfig: null,
          wsLinesAdded: null,
          wsLinesDeleted: null,
          taskId: 'task-1',
          taskName: 'Task A',
        },
        {
          wsId: WORKTREE_WS_ID,
          wsKind: 'worktree',
          wsType: 'local',
          wsPath: '/worktrees/feat-x',
          wsBranchName: 'feat/x',
          wsConfig: null,
          wsLinesAdded: null,
          wsLinesDeleted: null,
          taskId: 'task-2',
          taskName: 'Task B',
        },
      ],
    });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(WORKTREE_WS_ID);
  });

  it('marks workspace as isLive when registry.get returns a value', async () => {
    mocks.registryGet.mockImplementation((id: string) => (id === REPO_WS_ID ? {} : undefined));

    setupDb({
      repositoryWorkspaceId: REPO_WS_ID,
      taskWsRows: [],
      repoWsRow: {
        id: REPO_WS_ID,
        kind: 'project-root',
        type: 'local',
        path: '/repo',
        branchName: null,
        config: null,
        linesAdded: null,
        linesDeleted: null,
      },
    });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result[0].isLive).toBe(true);
  });

  it('returns project-root workspace first, then worktrees', async () => {
    setupDb({
      repositoryWorkspaceId: REPO_WS_ID,
      taskWsRows: [
        {
          wsId: WORKTREE_WS_ID,
          wsKind: 'worktree',
          wsType: 'local',
          wsPath: '/worktrees/feat-x',
          wsBranchName: 'feat/x',
          wsConfig: null,
          wsLinesAdded: null,
          wsLinesDeleted: null,
          taskId: 'task-1',
          taskName: 'My Feature',
        },
      ],
      repoWsRow: {
        id: REPO_WS_ID,
        kind: 'project-root',
        type: 'local',
        path: '/repo',
        branchName: null,
        config: null,
        linesAdded: null,
        linesDeleted: null,
      },
    });

    const result = await getProjectWorkspaces(PROJ_ID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(REPO_WS_ID);
    expect(result[1].id).toBe(WORKTREE_WS_ID);
  });
});
