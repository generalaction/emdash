import type { GitHeadModel, GitStatusModel, GitWorktreeUpdate } from '@emdash/shared/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@main/core/workspaces/workspace-current-branch-cache', () => ({
  refreshWorkspaceCurrentBranchCache: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { update: dbMocks.update },
}));

vi.mock('@main/db/schema', () => ({
  workspaces: { id: 'id' },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

const { refreshWorkspaceCurrentBranchCache } =
  await import('@main/core/workspaces/workspace-current-branch-cache');
const { handleGitWorktreeUpdate } = await import('./workspace-worktree-update');

function headUpdate(model: GitHeadModel): GitWorktreeUpdate {
  return { kind: 'head', model, sequence: 1, generation: 1 };
}

function statusUpdate(model: GitStatusModel): GitWorktreeUpdate {
  return { kind: 'status', model, sequence: 1, generation: 1 };
}

function mockUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  dbMocks.update.mockReturnValue({ set });
  return { set, where };
}

describe('handleGitWorktreeUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the branch cache before emitting a head update', async () => {
    const order: string[] = [];
    let resolveRefresh: () => void = () => {};
    vi.mocked(refreshWorkspaceCurrentBranchCache).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = () => {
          order.push('refresh');
          resolve({ branchName: 'feature/new', changed: true });
        };
      })
    );
    const emit = vi.fn(() => order.push('emit'));

    handleGitWorktreeUpdate(
      'ws-1',
      headUpdate({ kind: 'branch', name: 'feature/new', oid: 'abc' }),
      emit
    );

    // Emit must wait for the cache refresh to settle.
    expect(emit).not.toHaveBeenCalled();
    resolveRefresh();
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['refresh', 'emit']);
  });

  it('passes the branch name from a branch head to the cache', async () => {
    vi.mocked(refreshWorkspaceCurrentBranchCache).mockResolvedValue({
      branchName: 'feature/new',
      changed: true,
    });

    handleGitWorktreeUpdate(
      'ws-1',
      headUpdate({ kind: 'branch', name: 'feature/new', oid: 'abc' }),
      vi.fn()
    );

    const read = vi.mocked(refreshWorkspaceCurrentBranchCache).mock.calls[0][1];
    await expect(read()).resolves.toBe('feature/new');
  });

  it('caches a null branch for a detached head', async () => {
    vi.mocked(refreshWorkspaceCurrentBranchCache).mockResolvedValue({
      branchName: null,
      changed: true,
    });

    handleGitWorktreeUpdate(
      'ws-1',
      headUpdate({ kind: 'detached', shortHash: 'abc1234', oid: 'abc' }),
      vi.fn()
    );

    const read = vi.mocked(refreshWorkspaceCurrentBranchCache).mock.calls[0][1];
    await expect(read()).resolves.toBeNull();
  });

  it('emits status updates immediately and does not touch the branch cache', () => {
    mockUpdateChain();
    const emit = vi.fn();
    const status: GitStatusModel = {
      kind: 'ok',
      staged: [],
      unstaged: [],
      stagedAdded: 0,
      stagedDeleted: 0,
    };

    handleGitWorktreeUpdate('ws-1', statusUpdate(status), emit);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(refreshWorkspaceCurrentBranchCache).not.toHaveBeenCalled();
  });
});
