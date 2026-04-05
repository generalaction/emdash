import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main/services/DatabaseService', () => ({
  databaseService: {
    getGitPlatformForTaskPath: vi.fn().mockResolvedValue('github'),
  },
}));

vi.mock('../../../main/utils/remoteProjectResolver', () => ({
  resolveRemoteProjectForWorktreePath: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../main/services/GitHubService', () => ({
  githubService: {},
}));

vi.mock('../../../main/services/RemoteGitService', () => ({
  RemoteGitService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../main/services/ssh/SshService', () => ({
  sshService: {},
}));

import { getOperations } from '../../../main/services/gitPlatformOperations';
import { databaseService } from '../../../main/services/DatabaseService';
import { GitHubOperations } from '../../../main/services/gitPlatformOperations/GitHubOperations';
import { GitLabOperations } from '../../../main/services/gitPlatformOperations/GitLabOperations';

describe('getOperations', () => {
  it('returns GitHubOperations for github platform', async () => {
    vi.mocked(databaseService.getGitPlatformForTaskPath).mockResolvedValue('github');
    const ops = await getOperations('/some/path');
    expect(ops).toBeInstanceOf(GitHubOperations);
    expect(ops.platform).toBe('github');
  });

  it('returns GitLabOperations for gitlab platform', async () => {
    vi.mocked(databaseService.getGitPlatformForTaskPath).mockResolvedValue('gitlab');
    const ops = await getOperations('/some/path');
    expect(ops).toBeInstanceOf(GitLabOperations);
    expect(ops.platform).toBe('gitlab');
  });

  it('defaults to github when DB lookup fails', async () => {
    vi.mocked(databaseService.getGitPlatformForTaskPath).mockRejectedValue(new Error('no db'));
    const ops = await getOperations('/some/path');
    expect(ops).toBeInstanceOf(GitHubOperations);
  });
});
