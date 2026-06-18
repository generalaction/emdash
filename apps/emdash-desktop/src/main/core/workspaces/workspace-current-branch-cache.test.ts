import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: dbMocks.select,
    update: dbMocks.update,
  },
}));

vi.mock('@main/db/schema', () => ({
  workspaces: { id: 'id', branchName: 'branch_name' },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

const { refreshWorkspaceCurrentBranchCache } = await import('./workspace-current-branch-cache');

function queueSelect<T>(rows: T[]): void {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(rows);
  dbMocks.select.mockReturnValueOnce(query);
}

function mockUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  dbMocks.update.mockReturnValue({ set });
  return { set, where };
}

describe('refreshWorkspaceCurrentBranchCache', () => {
  beforeEach(() => {
    dbMocks.select.mockReset();
    dbMocks.update.mockReset();
  });

  it('writes the cache and reports changed when the branch differs', async () => {
    queueSelect([{ branchName: 'old-branch' }]);
    const update = mockUpdate();

    const result = await refreshWorkspaceCurrentBranchCache('ws-1', () =>
      Promise.resolve('new-branch')
    );

    expect(result).toEqual({ branchName: 'new-branch', changed: true });
    expect(update.set).toHaveBeenCalledWith({ branchName: 'new-branch' });
  });

  it('does not write and reports unchanged when the branch matches', async () => {
    queueSelect([{ branchName: 'same-branch' }]);

    const result = await refreshWorkspaceCurrentBranchCache('ws-1', () =>
      Promise.resolve('same-branch')
    );

    expect(result).toEqual({ branchName: 'same-branch', changed: false });
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('persists a null branch (detached HEAD) when previously set', async () => {
    queueSelect([{ branchName: 'old-branch' }]);
    const update = mockUpdate();

    const result = await refreshWorkspaceCurrentBranchCache('ws-1', () => Promise.resolve(null));

    expect(result).toEqual({ branchName: null, changed: true });
    expect(update.set).toHaveBeenCalledWith({ branchName: null });
  });

  it('returns undefined when the workspace is not found', async () => {
    queueSelect([]);

    const result = await refreshWorkspaceCurrentBranchCache('missing', () =>
      Promise.resolve('any')
    );

    expect(result).toBeUndefined();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('returns undefined and swallows errors when reading the branch throws', async () => {
    const result = await refreshWorkspaceCurrentBranchCache('ws-1', () =>
      Promise.reject(new Error('git boom'))
    );

    expect(result).toBeUndefined();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });
});
