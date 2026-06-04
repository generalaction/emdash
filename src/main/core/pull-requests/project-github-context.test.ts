import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import { err, ok } from '@shared/result';
import { resolveProjectGitHubContext } from './project-github-context';

vi.mock('@main/core/repository/provider-repository-service', () => ({
  providerRepositoryService: {
    resolveProject: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: vi.fn(),
}));

const mockProviderRepositoryService = vi.mocked(providerRepositoryService);
const mockResolveProjectGitHubAuthContext = vi.mocked(resolveProjectGitHubAuthContext);

describe('resolveProjectGitHubContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combines the project GitHub repository and auth context', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue({ accountId: 'github.com:42' });

    await expect(resolveProjectGitHubContext('project-1')).resolves.toEqual(
      ok({
        projectId: 'project-1',
        repositoryUrl: 'https://github.com/acme/repo',
        host: 'github.com',
        nameWithOwner: 'acme/repo',
        authContext: { accountId: 'github.com:42' },
      })
    );
    expect(mockProviderRepositoryService.resolveProject).toHaveBeenCalledWith('project-1');
    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('returns the project repository error without resolving account context', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(err({ type: 'no_remote' }));

    await expect(resolveProjectGitHubContext('project-1')).resolves.toEqual(
      err({ type: 'no_remote' })
    );
    expect(mockResolveProjectGitHubAuthContext).not.toHaveBeenCalled();
  });
});
