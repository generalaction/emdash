import { describe, expect, it, vi, beforeEach } from 'vitest';

const FIXTURE_HOST_A = {
  id: 'project-host-a',
  name: 'Project on Host A',
  path: '/srv/repo',
  isRemote: true,
  sshConnectionId: 'ssh-host-a',
  remotePath: '/srv/repo',
  gitInfo: { isGitRepo: true, branch: 'main', baseRef: 'main' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const FIXTURE_HOST_B = {
  id: 'project-host-b',
  name: 'Project on Host B',
  path: '/srv/repo',
  isRemote: true,
  sshConnectionId: 'ssh-host-b',
  remotePath: '/srv/repo',
  gitInfo: { isGitRepo: true, branch: 'main', baseRef: 'main' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getProjects: vi.fn(),
  },
}));

import { databaseService } from '../../main/services/DatabaseService';
import { resolveRemoteProjectForWorktreePath } from '../../main/utils/remoteProjectResolver';

describe('resolveRemoteProjectForWorktreePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The resolver matches worktreePath against remotePath + '/', so a worktree at
  // /srv/repo/.worktrees/task-1 matches remotePath /srv/repo
  const worktreeOfRepo = '/srv/repo/.worktrees/task-1';

  it('returns null when no projects match the path', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([]);
    const result = await resolveRemoteProjectForWorktreePath('/some/other/path');
    expect(result).toBeNull();
  });

  it('returns the unique match when only one project matches', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([FIXTURE_HOST_A]);
    const result = await resolveRemoteProjectForWorktreePath(worktreeOfRepo);
    expect(result).not.toBeNull();
    expect(result!.sshConnectionId).toBe('ssh-host-a');
  });

  it('uses sshConnectionId filter when provided', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([FIXTURE_HOST_A, FIXTURE_HOST_B]);
    const result = await resolveRemoteProjectForWorktreePath(worktreeOfRepo, 'ssh-host-b');
    expect(result).not.toBeNull();
    expect(result!.sshConnectionId).toBe('ssh-host-b');
    expect(result!.id).toBe('project-host-b');
  });

  it('returns null when sshConnectionId is provided but no match', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([FIXTURE_HOST_A, FIXTURE_HOST_B]);
    const result = await resolveRemoteProjectForWorktreePath(worktreeOfRepo, 'ssh-nonexistent');
    expect(result).toBeNull();
  });

  it('throws when multiple hosts share the same path and no sshConnectionId is provided', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([FIXTURE_HOST_A, FIXTURE_HOST_B]);
    await expect(resolveRemoteProjectForWorktreePath(worktreeOfRepo)).rejects.toThrow(
      /Multiple remote projects match path.*but no sshConnectionId was provided to disambiguate/i
    );
  });

  it('does not throw when sshConnectionId is provided even with multiple matching hosts', async () => {
    vi.mocked(databaseService.getProjects).mockResolvedValue([FIXTURE_HOST_A, FIXTURE_HOST_B]);
    const result = await resolveRemoteProjectForWorktreePath(worktreeOfRepo, 'ssh-host-a');
    expect(result).not.toBeNull();
    expect(result!.sshConnectionId).toBe('ssh-host-a');
  });
});
