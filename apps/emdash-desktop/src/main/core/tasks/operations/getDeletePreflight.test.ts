import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  getProject: vi.fn(),
  acquire: vi.fn(),
  getProvisionedWorkspaceBranch: vi.fn(),
  getWorktree: vi.fn(),
  openWorktree: vi.fn(),
  getStatus: vi.fn(),
  releaseRuntime: vi.fn(),
  releaseWorktree: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  ne: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/runtime/runtime-manager', () => ({
  runtimeManager: { acquire: mocks.acquire },
}));

vi.mock('@main/core/workspaces/workspace-branch', () => ({
  getProvisionedWorkspaceBranch: mocks.getProvisionedWorkspaceBranch,
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@main/db/schema', () => ({
  tasks: {},
  workspaces: {},
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getDeletePreflight } = await import('./getDeletePreflight');

/** Queues rows per db.select() call: task lookup, workspace lookup, sibling lookup. */
function queueSelectResults(...results: unknown[][]): void {
  const queue = [...results];
  mocks.select.mockImplementation(() => {
    const rows = queue.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  });
}

const TASK_ROW = { id: 't1', workspaceId: 'ws1' };
const WORKSPACE_ROW = {
  id: 'ws1',
  config: { git: { kind: 'create-branch', fromBranch: { branch: 'main' } } },
};

function queueProvisionedTask(): void {
  queueSelectResults([TASK_ROW], [WORKSPACE_ROW], []);
}

beforeEach(() => {
  vi.clearAllMocks();
  queueProvisionedTask();
  mocks.getProvisionedWorkspaceBranch.mockReturnValue('feat-x');
  mocks.getProject.mockReturnValue({
    defaultWorkspaceMachine: 'local',
    worktreeService: { getWorktree: mocks.getWorktree },
  });
  mocks.getWorktree.mockResolvedValue('/worktrees/feat-x');
  mocks.acquire.mockResolvedValue({
    value: { git: { openWorktree: mocks.openWorktree } },
    release: mocks.releaseRuntime,
  });
  mocks.openWorktree.mockResolvedValue({
    value: { getStatus: mocks.getStatus },
    release: mocks.releaseWorktree,
  });
  mocks.getStatus.mockResolvedValue({ kind: 'ok', staged: [], unstaged: [] });
});

describe('getDeletePreflight', () => {
  it('reports no worktree for an unknown task', async () => {
    queueSelectResults([]);
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks).toEqual([
      { taskId: 't1', hasWorktree: false, hasUncommittedChanges: false, hasDeletableBranch: false },
    ]);
  });

  it('reports no worktree when the workspace is shared with another task', async () => {
    queueSelectResults([TASK_ROW], [WORKSPACE_ROW], [{ id: 'other-task' }]);
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]).toMatchObject({ hasWorktree: false, hasDeletableBranch: false });
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it('reports a clean provisioned worktree as deletable', async () => {
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks).toEqual([
      { taskId: 't1', hasWorktree: true, hasUncommittedChanges: false, hasDeletableBranch: true },
    ]);
  });

  it('reports staged changes as uncommitted', async () => {
    mocks.getStatus.mockResolvedValue({ kind: 'ok', staged: ['a.ts'], unstaged: [] });
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
  });

  it('reports unstaged changes as uncommitted', async () => {
    mocks.getStatus.mockResolvedValue({ kind: 'ok', staged: [], unstaged: ['b.ts'] });
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
  });

  it('fails closed when git status reports an error', async () => {
    mocks.getStatus.mockResolvedValue({ kind: 'error', message: 'index locked' });
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
  });

  it('fails closed when the worktree has too many files to scan', async () => {
    mocks.getStatus.mockResolvedValue({ kind: 'too-many-files' });
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
  });

  it('fails closed when the status check throws', async () => {
    mocks.getWorktree.mockRejectedValue(new Error('runtime gone'));
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
  });

  it('releases the worktree and runtime leases even when getStatus throws', async () => {
    mocks.getStatus.mockRejectedValue(new Error('boom'));
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(true);
    expect(mocks.releaseWorktree).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRuntime).toHaveBeenCalledTimes(1);
  });

  it('skips the git check when the project is not open', async () => {
    // Current behavior: without an open project the check cannot run and the
    // task is reported clean; MCP delete_task compensates by opening the
    // project first and failing closed when that is impossible.
    mocks.getProject.mockReturnValue(undefined);
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]?.hasUncommittedChanges).toBe(false);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it('reports the branch as not deletable when it matches the source branch', async () => {
    mocks.getProvisionedWorkspaceBranch.mockReturnValue('main');
    const result = await getDeletePreflight('p1', ['t1']);
    expect(result.tasks[0]).toMatchObject({ hasWorktree: true, hasDeletableBranch: false });
  });
});
